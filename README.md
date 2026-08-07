# CRM by Elivate

Self-hosted **CRM by Elivate**, powered by [Twenty](https://twenty.com/), prepared for GitHub-to-Railway delivery.

## Pinned release

Both application images are pinned to Twenty `v2.27.0`, released on 4 August 2026. Upgrades should be made deliberately by changing both Dockerfiles to the same tested version.

## Architecture

The Railway project uses five resources in one region:

- `twenty-server`: public web/API service built from `Dockerfile`
- `twenty-worker`: background worker built from `Dockerfile.worker`
- Railway PostgreSQL
- Railway Redis
- `crm-files`: Railway S3-compatible storage bucket

The server and worker must use the same database, Redis instance, encryption key, and object-storage configuration.

Provisioned Railway project:

- Workspace: `Quality Performance`
- Project: `CRM by Elivate`
- Environment: `production`
- Temporary HTTPS URL: <https://twenty-server-production-9d4c.up.railway.app>

PostgreSQL, Redis, the storage bucket, the HTTPS domain, and all application variable references are configured. Both application services deploy from this repository's `main` branch.

## Product branding

The server image applies the **CRM by Elivate** identity at build time to the first-workspace sign-in screen, browser metadata, favicon, and install manifest. The overlay is intentionally narrow: it preserves Twenty's authentication layout and behavior while replacing its public entry-point branding.

After creating the first administrator, also set the workspace name to **CRM by Elivate** under **Settings → General** and upload `assets/elivate-icon-transparent.png` as the workspace picture. Twenty stores this workspace-level branding separately from the pre-login assets.

`scripts/apply-branding.mjs` fails the server build if a pinned Twenty upgrade removes the expected onboarding text or metadata. Review and update the overlay whenever either Dockerfile is moved to a new Twenty release.

## Run locally

1. Copy `.env.example` to `.env`.
2. Replace the database password and generate `ENCRYPTION_KEY` with `openssl rand -base64 32`.
3. Run `docker compose up -d`.
4. Open <http://localhost:3000> and verify <http://localhost:3000/healthz>.

## GitHub handoff

This folder intentionally contains no GitHub Actions workflow. Pushes and repository management are handled by the repository owner.

After the repository exists, connect its `main` branch to both Railway application services:

- `twenty-server`: `RAILWAY_DOCKERFILE_PATH=Dockerfile`
- `twenty-worker`: `RAILWAY_DOCKERFILE_PATH=Dockerfile.worker`

Railway then builds and deploys each service whenever the connected branch changes.

## Railway variables

Configure the following on both application services, using Railway reference variables wherever possible:

```text
PG_DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
SERVER_URL=https://${{twenty-server.RAILWAY_PUBLIC_DOMAIN}}
ENCRYPTION_KEY=<same generated secret on server and worker>
STORAGE_TYPE=S_3
STORAGE_S3_REGION=${{crm-files.REGION}}
STORAGE_S3_NAME=${{crm-files.BUCKET}}
STORAGE_S3_ENDPOINT=${{crm-files.ENDPOINT}}
STORAGE_S3_ACCESS_KEY_ID=${{crm-files.ACCESS_KEY_ID}}
STORAGE_S3_SECRET_ACCESS_KEY=${{crm-files.SECRET_ACCESS_KEY}}
```

Add these server-only variables:

```text
NODE_PORT=3000
DISABLE_DB_MIGRATIONS=false
DISABLE_CRON_JOBS_REGISTRATION=false
```

Add these worker-only variables:

```text
DISABLE_DB_MIGRATIONS=true
DISABLE_CRON_JOBS_REGISTRATION=true
```

The server receives the public domain on port `3000`; PostgreSQL, Redis, the worker, and bucket remain private.

## Production verification

- `GET /healthz` succeeds over HTTPS.
- The first workspace and administrator can be created.
- A record survives a server redeploy.
- A file upload survives both server and worker redeploys.
- Worker logs show background jobs running without database or Redis errors.
- PostgreSQL backups are enabled and a restore procedure is documented and tested.
