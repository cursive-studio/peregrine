# Batch certificates

The Astro website stays on Vercel. A separate Cloudflare Worker serves the API, D1 stores batch records, and a private R2 bucket stores certificate PDFs and images. `/liva/trace` is the permanent public lookup route; `/certificates` remains a compatible entry point. `/admin` requires the staff password; management API requests require a signed four-hour session token. The password and signing secret never reach the website bundle. Signing out removes the browser token; rotate SESSION_SECRET to invalidate all sessions.

## Local development

1. Copy `worker/.dev.vars.example` to `worker/.dev.vars` and set a long password and a random session secret of at least 32 characters. Never use the test credentials in production.
2. Run `pnpm certificates:migrate:local`.
3. Run `pnpm certificates:dev` in one terminal and `pnpm dev` in another.
4. Open `/admin` and `/certificates` on the Astro server. Development defaults to the API at `http://localhost:8787`.

The local D1/R2 emulator persists in `.wrangler` and does not create cloud resources.

## Cloudflare setup

Run these commands from the repository root after signing in with `pnpm exec wrangler login`:

```sh
pnpm exec wrangler d1 create peregrine-certificates
pnpm exec wrangler r2 bucket create peregrine-certificates
```

The repository configuration points to the provisioned Peregrine Cloudflare account and D1 database. For a new account, replace `account_id` and `database_id` in `worker/wrangler.jsonc` with its IDs. Keep the bucket private (do not enable public access). Set `ALLOWED_ORIGINS` to the exact production website origins. Add individual preview origins only when needed; do not use a wildcard.

```sh
pnpm exec wrangler secret put ADMIN_PASSWORD --config worker/wrangler.jsonc
pnpm exec wrangler secret put SESSION_SECRET --config worker/wrangler.jsonc
pnpm exec wrangler d1 migrations apply DB --remote --config worker/wrangler.jsonc
pnpm certificates:deploy
```

Set `PUBLIC_CERTIFICATES_API_URL` in the Vercel project to the deployed Worker HTTPS URL (without a trailing slash), then rebuild/redeploy the website. The only website environment variable is a public API address. R2 billing activation may require a payment method; check the account's current allowances before provisioning.

## Verification

The integration test uses a local Worker. Set `TEST_ADMIN_PASSWORD` to match its password. It creates and deletes its own test batch:

```sh
TEST_ADMIN_PASSWORD=your-local-password node worker/test/integration.mjs
pnpm build
```

Staff workflow: sign in at `/admin`, add a batch number and certificate file, choose whether to publish, then save. Supported formats are PDF, JPG/JPEG, PNG, WebP, and GIF. Existing batches can be edited, unpublished, or deleted. Batch numbers are trimmed and uppercased; punctuation and internal spaces are retained. One certificate file may be uploaded for each batch, including the same source file for multiple batches. Uploads are limited to 10 MB and checked for supported file signatures rather than trusting the supplied extension or MIME type. Files are streamed with their detected content type and matching filename extension. Existing PDFs remain compatible without a database migration. Bottle/QR links use `/liva/trace?batch=THE-BATCH-NUMBER` and automatically load the matching certificate. Existing `/certificates?batch=...` links continue to work. Each admin row offers Copy batch link and Download QR code; the QR download is an SVG with black modules on white and a four-module quiet zone. Links always use the production www domain, even from local/preview admin pages.

Login is limited to ten attempts per IP per fifteen minutes using D1. This is a shared-password dashboard for a small staff team, without individual accounts or an audit history. Public certificate requests query published records and stream certificate files through the Worker; draft files cannot be accessed by their R2 keys.

## Production connection

- API: `https://peregrine-certificates.peregrine-creative-group.workers.dev`
- Website: `https://peregrinecreativegroup.com/liva`
- Administration: `https://peregrinecreativegroup.com/admin`
- Vercel: project `peregrine` in team `verlay`; production uses `PUBLIC_CERTIFICATES_API_URL` above.
- Cloudflare: D1 database and private R2 bucket both named `peregrine-certificates`.

The production admin password and session signing secret are kept in the ignored, owner-readable `worker/.env.production` file on the setup computer. Use its `ADMIN_PASSWORD` to sign in to `/admin`. Store these values in your password manager; never commit or share this file. It is excluded from Vercel uploads along with the Worker directory. Production secrets are separate from `worker/.dev.vars`.

Deploy Worker code updates with `pnpm certificates:deploy`; Cloudflare retains existing secrets. To deliberately rotate credentials, update the ignored production file and run `pnpm exec wrangler deploy --config worker/wrangler.jsonc --secrets-file worker/.env.production`. Rotating `SESSION_SECRET` invalidates existing staff sessions.

Publish a real batch and upload its matching certificate in `/admin` before directing customers to look it up. There are no sample certificates published by default.
