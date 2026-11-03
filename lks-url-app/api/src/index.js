const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const TABLE = process.env.DYNAMODB_TABLE;
const REGION = process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-east-1';
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const CACHE_TTL_SECONDS = 3600;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // RDS PostgreSQL 17 mewajibkan SSL
  max: 10,
});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sqs = new SQSClient({ region: REGION });

async function initDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS links (
          code TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      console.log('database ready');
      return;
    } catch (e) {
      console.error('db init failed, retrying:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'api' }));

function newCode() {
  return crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 6);
}

app.post('/api/links', async (req, res) => {
  const { url, alias } = req.body || {};
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'URL tidak valid' });
  }
  if (alias && !/^[A-Za-z0-9_-]{3,32}$/.test(alias)) {
    return res.status(400).json({ error: 'Alias hanya boleh huruf/angka/-/_ (3-32 karakter)' });
  }
  const code = alias || newCode();
  try {
    await pool.query('INSERT INTO links (code, url) VALUES ($1, $2)', [code, url]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Alias sudah dipakai' });
    console.error(e);
    return res.status(500).json({ error: 'Gagal menyimpan link' });
  }
  res.status(201).json({ code, url, short_url: `${BASE_URL}/s/${code}` });
});

app.get('/api/links', async (_req, res) => {
  try {
    const r = await pool.query('SELECT code, url, created_at FROM links ORDER BY created_at DESC LIMIT 20');
    res.json(r.rows.map((l) => ({ ...l, short_url: `${BASE_URL}/s/${l.code}` })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

async function resolve(code) {
  // 1. cache DynamoDB
  try {
    const c = await ddb.send(new GetCommand({ TableName: TABLE, Key: { code } }));
    if (c.Item && c.Item.url) return c.Item.url;
  } catch (e) {
    console.error('cache get error:', e.message);
  }
  // 2. database
  const r = await pool.query('SELECT url FROM links WHERE code = $1', [code]);
  if (!r.rows.length) return null;
  const url = r.rows[0].url;
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { code, url, ttl: Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS },
    }));
  } catch (e) {
    console.error('cache put error:', e.message);
  }
  return url;
}

app.get('/s/:code', async (req, res) => {
  const code = req.params.code;
  try {
    const url = await resolve(code);
    if (!url) return res.status(404).json({ error: 'Short link tidak ditemukan' });

    // kirim event klik secara async, jangan blok redirect
    sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        code,
        timestamp: new Date().toISOString(),
        userAgent: req.get('user-agent') || '',
        referer: req.get('referer') || '',
      }),
    })).catch((e) => console.error('sqs error:', e.message));

    res.redirect(302, url);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`api listening on ${PORT} (${process.env.NODE_ENV})`);
  initDb();
});
