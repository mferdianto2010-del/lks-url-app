# API Service (port 3000)

Mengelola short link (CRUD) dan redirect `/s/:code`.

## Environment variables
| Nama | Sumber (SSM `/lks-url/{KEY}`) | Keterangan |
|---|---|---|
| PORT | port-api | Port service (3000) |
| DATABASE_URL | db-url | Connection string PostgreSQL |
| SQS_QUEUE_URL | sqs-url | Queue click-events |
| BASE_URL | base-url | URL ALB (untuk membentuk short_url) |
| DYNAMODB_TABLE | dynamodb-table | Tabel cache |
| DYNAMODB_REGION | dynamodb-region | Region tabel |
| NODE_ENV | - | `production` |

## Endpoint
- `GET  /api/health`
- `POST /api/links` body `{ "url": "https://...", "alias": "opsional" }`
- `GET  /api/links`
- `GET  /s/:code` -> 302 redirect + kirim event ke SQS
