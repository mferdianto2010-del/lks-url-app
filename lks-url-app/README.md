# lks-url-app

Monorepo URL Shortener: `api` (3000), `analytics` (3001), `frontend` (80).

Tiap service punya `Dockerfile`, `README.md` (daftar env var), dan folder `src/`.
Workflow `deploy-<service>.yml` membangun image, push ke ECR `lks-url-<service>`
dan memaksa deployment baru di ECS service `lks-url-<service>-svc`.

Setelah ketiga workflow sukses, hapus `.github/workflows/deploy-template.yml`.
Jangan ubah `classroom.yml`, `.github/classroom/`, `.github/scripts/`.
