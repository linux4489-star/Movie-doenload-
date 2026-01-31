Deploying to Vercel (Serverless functions + Cloudflare R2)

This project is configured to run the frontend as static files and the backend endpoints as Vercel serverless functions (see `vercel.json`). The serverless endpoints expect Cloudflare R2 to be configured for storage.

Environment variables (set these in Vercel Project Settings):
- `R2_ENDPOINT` - Cloudflare R2 endpoint (e.g., https://<accountid>.r2.cloudflareresources.com)
- `R2_ACCESS_KEY_ID` - R2 access key id
- `R2_SECRET_ACCESS_KEY` - R2 secret access key
- `R2_BUCKET` - R2 bucket name
- `R2_PUBLIC_BASE_URL` - public base URL for objects (optional)
- `OWNER_HASH` - SHA-256 hash of the owner password used by the frontend client (see below)

How to derive `OWNER_HASH` (client/server match):
1. In the browser console (or Node), run a SHA-256 of your chosen password and put the hex digest into `OWNER_HASH`.
2. On the client, the owner password UI stores the SHA-256 digest in `localStorage` under `movie_owner_hash`. Ensure owner sets a password and that the digest matches the server `OWNER_HASH`.

Notes:
- Serverless functions cannot persist a writable file across instances. This implementation stores metadata objects under `meta/` in R2 (recommended). If you need a database, consider using a hosted DB (Supabase, PlanetScale, etc.).
- Make sure to configure R2 CORS to allow PUT from your frontend origin when testing uploads using presigned URLs.

GitHub Actions (optional automated preview deploy)

You can enable automated preview deployments using GitHub Actions. Add the following GitHub repository secrets (Repository Settings → Secrets):
- `VERCEL_TOKEN` — your personal Vercel token
- `VERCEL_ORG_ID` — the Vercel organization id
- `VERCEL_PROJECT_ID` — the Vercel project id

I added an example workflow `.github/workflows/vercel-deploy.yml` that runs on PRs and pushes to `main`. It uses `amondnet/vercel-action` and will create Vercel preview deployments (no `--prod` flag). If you want automatic production deploys on merge, change `vercel-args` to `--prod`.

Environment variables to set in Vercel project (Vercel Dashboard → Settings → Environment Variables):
- `R2_ENDPOINT` (e.g. `https://<accountid>.r2.cloudflareresources.com`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL` (optional)
- `OWNER_HASH` — SHA-256 of the owner password (hex digest)

How to compute `OWNER_HASH` locally:
- Node: `node -e "console.log(require('crypto').createHash('sha256').update('your-password').digest('hex'))"`
- Paste the resulting hex into the `OWNER_HASH` env var in Vercel (use the same password client-side via the Set Owner Password UI).

Once secrets are set, open a PR or push to `main` to trigger a preview deployment. The workflow will log the Vercel preview URL in the actions output.
