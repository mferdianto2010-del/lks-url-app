# Analytics Service (port 3001)

Mengambil event klik dari SQS, menyimpannya ke PostgreSQL, dan menyajikan statistik.

## Environment variables
| Nama | Sumber (SSM `/lks-url/{KEY}`) | Keterangan |
|---|---|---|
| PORT | port-analytics | Port service (3001) |
| DATABASE_URL | db-url | Connection string PostgreSQL |
| SQS_QUEUE_URL | sqs-url | Queue click-events |
| DYNAMODB_REGION | dynamodb-region | Dipakai sebagai region AWS SDK |
| BASE_URL | base-url | (info) URL ALB |
| DYNAMODB_TABLE | dynamodb-table | (tidak dipakai, tersedia) |
| NODE_ENV | - | `production` |

## Endpoint
- `GET /api/health`
- `GET /api/stats/overview` -> total, timeline, device, browser, top links
- `GET /api/stats/code/:code` -> statistik satu short code
