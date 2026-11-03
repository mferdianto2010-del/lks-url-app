const express = require('express');
const { Pool } = require('pg');
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

const PORT = parseInt(process.env.PORT || '3001', 10);
const REGION = process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-east-1';
const QUEUE_URL = process.env.SQS_QUEUE_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});
const sqs = new SQSClient({ region: REGION });

function parseUA(ua = '') {
  const s = ua.toLowerCase();
  const device = /ipad|tablet/.test(s) ? 'Tablet'
    : /mobi|android|iphone/.test(s) ? 'Mobile' : 'Desktop';
  let browser = 'Other';
  if (/edg\//.test(s)) browser = 'Edge';
  else if (/opr\/|opera/.test(s)) browser = 'Opera';
  else if (/chrome|crios/.test(s)) browser = 'Chrome';
  else if (/firefox|fxios/.test(s)) browser = 'Firefox';
  else if (/safari/.test(s)) browser = 'Safari';
  else if (/curl|wget|python|node|bot/.test(s)) browser = 'Bot/CLI';
  return { device, browser };
}

async function initDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS click_events (
          id BIGSERIAL PRIMARY KEY,
          code TEXT NOT NULL,
          clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          user_agent TEXT,
          referer TEXT,
          device TEXT,
          browser TEXT
        )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_click_code ON click_events (code)');
      console.log('database ready');
      return true;
    } catch (e) {
      console.error('db init failed, retrying:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return false;
}

async function pollQueue() {
  while (true) {
    try {
      const out = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
      }));
      for (const m of out.Messages || []) {
        try {
          const e = JSON.parse(m.Body);
          const { device, browser } = parseUA(e.userAgent);
          await pool.query(
            'INSERT INTO click_events (code, clicked_at, user_agent, referer, device, browser) VALUES ($1,$2,$3,$4,$5,$6)',
            [e.code, e.timestamp || new Date().toISOString(), e.userAgent, e.referer, device, browser]
          );
          await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: m.ReceiptHandle }));
        } catch (err) {
          // tidak dihapus -> akan diproses ulang, setelah 5x masuk DLQ
          console.error('process error:', err.message);
        }
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const app = express();

app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'analytics' }));

app.get('/api/stats/overview', async (_req, res) => {
  try {
    const [total, timeline, device, browser, top] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM click_events'),
      pool.query(`SELECT to_char(date_trunc('hour', clicked_at), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS t, COUNT(*)::int AS n
                  FROM click_events WHERE clicked_at > NOW() - INTERVAL '24 hours'
                  GROUP BY 1 ORDER BY 1`),
      pool.query('SELECT device AS label, COUNT(*)::int AS n FROM click_events GROUP BY 1 ORDER BY 2 DESC'),
      pool.query('SELECT browser AS label, COUNT(*)::int AS n FROM click_events GROUP BY 1 ORDER BY 2 DESC'),
      pool.query('SELECT code AS label, COUNT(*)::int AS n FROM click_events GROUP BY 1 ORDER BY 2 DESC LIMIT 5'),
    ]);
    res.json({
      total_clicks: total.rows[0].n,
      timeline: timeline.rows,
      devices: device.rows,
      browsers: browser.rows,
      top_links: top.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil statistik' });
  }
});

app.get('/api/stats/code/:code', async (req, res) => {
  const code = req.params.code;
  try {
    const [total, timeline, device, browser] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM click_events WHERE code=$1', [code]),
      pool.query(`SELECT to_char(date_trunc('hour', clicked_at), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS t, COUNT(*)::int AS n
                  FROM click_events WHERE code=$1 AND clicked_at > NOW() - INTERVAL '24 hours'
                  GROUP BY 1 ORDER BY 1`, [code]),
      pool.query('SELECT device AS label, COUNT(*)::int AS n FROM click_events WHERE code=$1 GROUP BY 1 ORDER BY 2 DESC', [code]),
      pool.query('SELECT browser AS label, COUNT(*)::int AS n FROM click_events WHERE code=$1 GROUP BY 1 ORDER BY 2 DESC', [code]),
    ]);
    res.json({ code, total_clicks: total.rows[0].n, timeline: timeline.rows, devices: device.rows, browsers: browser.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil statistik' });
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`analytics listening on ${PORT} (${process.env.NODE_ENV})`);
  await initDb();
  pollQueue();
});
