# CRM by Elivate

Self-hosted **CRM by Elivate**, powered by [Twenty](https://twenty.com/), prepared for GitHub-to-Railway delivery.

## Pinned release

Both application images are pinned to Twenty `v2.27.0`, released on 4 August 2026. Upgrades should be made deliberately by changing both Dockerfiles to the same tested version.

## Architecture

The Railway project uses six resources in one region:

- `twenty-server`: public web/API service built from `Dockerfile`
- `twenty-worker`: background worker built from `Dockerfile.worker`
- `intake`: public intake-forms service built from `Dockerfile.intake`
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

## Frontend caching

The same build overlay gives content-hashed files under `/assets/` a one-year immutable browser cache so authenticated navigation does not repeatedly revalidate hundreds of unchanged frontend chunks. Bundles modified by the branding overlay receive a one-hour cache because their upstream filenames no longer represent their final content exactly.

HTML, runtime configuration, APIs, authentication, and user-file routes retain Twenty's original dynamic cache behavior. Railway CDN caching remains disabled until browser-cache behavior is verified on the deployed application.

## Intake forms

`intake` is a separate Railway service that serves the public **Elivate
Network** intake forms and writes submissions into the CRM. It is a dependency-free Node service using only
the standard library, built from `Dockerfile.intake`.

| Route | Purpose |
| --- | --- |
| `/` | Index listing the available forms |
| `/prospect` | New-prospect form |
| `/member` | Join Elivate Network member registration |
| `/order` | Monthly product order for team pickup |
| `GET /api/teams` | Team names read live from the CRM |
| `POST /api/prospects` | Creates a prospect record |
| `/healthz` | Health check, reports whether CRM access is configured |

The form's Team dropdown is populated from the **Team** object in the CRM, so
adding or renaming a team in Twenty changes the form with no redeploy. Teams
with an empty name are skipped.

### Member emails

A registration is not an approval. Submitting the form saves the member as
**Pending Approval** and sends an application-received email. Moving them to
**Registered** in the CRM is the approval, and that sends the welcome email
carrying their member ID and the three getting-started steps.

The CRM cannot call this service, so approval is noticed by polling: the
service looks for members who are Registered but have no welcome stamp. The
stamp is written before the message is sent, so a slow send cannot be picked
up twice, and is cleared again if delivery fails so the next pass retries.

### Member IDs

Registration assigns every member an `ELV-XXX` identifier, three random digits,
shown on the confirmation screen. It is random rather than sequential so an id
reveals nothing about how many people have joined, and it is checked against
the workspace before being issued. A member who registers again keeps the id
they already have. The format holds 1000 members.

### Pickup orders

Members submit their monthly order for collection: full name, member ID, order
ID, NeoLife ID, and WhatsApp number. Each submission becomes a **Pickup Order**
record linked to the member's Person record, matched on the member ID and
falling back to the WhatsApp number.

An order can arrive before its member registers. When that member later
registers, any earlier order matching their member ID or WhatsApp number is
attached to the new record, so nothing submitted early is stranded.

An order is a repeating event, so it is a record of its own rather than fields
on the person: a member orders again every month, and order fields on a Person
would overwrite last month's details. An order whose number matches no member
is still saved and simply left unlinked, so nothing a member submits is lost.

### How a prospect is stored

Each submission writes two linked records, matching the existing
Teams ↔ Opportunities relation in the workspace:

1. A **Person** holding the contact details — name, email, and the WhatsApp
   number in the standard `phones` field.
2. An **Opportunity** named after the prospect, created at stage `New`, linked
   to the chosen **Team** and pointing at the person as its Point of Contact.

The person is created first; if the opportunity then fails, the request reports
an error rather than a false success, so a half-written prospect is visible
instead of silently lost.

WhatsApp numbers are Nigerian only. Input in any common local format
(`0801 234 5678`, `801-234-5678`, `+234 801 234 5678`) is stored as E.164
(`+2348012345678`), and the same rule is enforced on the server, so a submission
that bypasses the browser is still rejected.

### Why a separate service

The CRM API key must never reach the browser. A key shipped in public
JavaScript can be read by any visitor and used to read or modify the whole
workspace. `intake` holds the key server-side and is the only component that
talks to the CRM API.

### Railway setup

1. Create a service named `intake` from this repository, set its Dockerfile
   path to `Dockerfile.intake`, and generate a domain for it.
2. In the CRM, create an API key under **Settings → APIs & Webhooks**.
3. Set these variables on the `intake` service:

   | Variable | Value |
   | --- | --- |
   | `TWENTY_API_URL` | `http://${{twenty-server.RAILWAY_PRIVATE_DOMAIN}}:3000` |
   | `TWENTY_API_KEY` | the API key from step 2 |

   Using the private domain keeps intake-to-CRM traffic inside the Railway
   project. `PORT` is provided by Railway automatically.

4. If your objects are not named `teams` / `prospects`, or the team's name field
   is not `name`, override `TWENTY_TEAM_OBJECT`, `TWENTY_TEAM_NAME_FIELD`, or
   `TWENTY_PROSPECT_OBJECT` to match the workspace.

Verify with `/healthz`: `crmConfigured: true` means the key and URL are set.

### Custom domain

To serve the forms from `forms.elivate.network`, add it under **Settings →
Networking → Custom Domain** on the `intake` service (not on `twenty-server`),
then create the `CNAME` record Railway shows at your DNS provider. Railway
issues the TLS certificate once the record resolves. The CRM keeps its own
separate domain.

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
