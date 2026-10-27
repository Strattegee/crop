# Staging deployment

Staging runs on the `crop-staging` droplet (DigitalOcean SYD1, 170.64.173.4) at https://staging.cropwms.com.

- `cropwms.com` → public website (holding page, `/privacy`, `/support`) from `deploy/staging/site`; `www` redirects to it.
- staging `/` → web app, `/api/*` → API (prefix stripped), `/api/docs` → OpenAPI docs.
- Every push to `main` deploys automatically (`.github/workflows/deploy-staging.yml`): the workflow copies the commit to `/srv/crop/app` and runs `docker compose up -d --build`. Migrations run in the `migrate` service before the API starts.

## One-time server setup (as `crop`)

```sh
sudo mkdir -p /srv/crop && sudo chown crop:crop /srv/crop
umask 077; printf 'POSTGRES_PASSWORD=%s\nAPP_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > /srv/crop/.env
docker rm -f caddy   # the placeholder container; compose runs its own Caddy
```

Add the deploy public key to `/home/crop/.ssh/authorized_keys`. In GitHub (Settings → Secrets and variables → Actions):
- Variable `STAGING_HOST` = 170.64.173.4 (deploys are skipped until this is set)
- Secret `STAGING_SSH_KEY` = the matching private key

## Useful commands (on the server)

```sh
cd /srv/crop/app/deploy/staging
docker compose --env-file /srv/crop/.env ps
docker compose --env-file /srv/crop/.env logs -f api
```

## Sign-in and giving people access

Sign-in settings (Zitadel issuer, project and client IDs) are in `compose.yml`; they aren't secret. The deploy workflow adds a random `SESSION_SECRET` to `/srv/crop/.env` the first time.

To give someone access, use the **Invite someone to staging** workflow (GitHub → Actions → Run workflow): agency slug, agency name, email, role. They get access the first time they sign in with that email once Zitadel has verified it. Roles: owner, admin, allocator, worker, client.

The same on the server:
```sh
cd /srv/crop/app/deploy/staging
docker compose --env-file /srv/crop/.env run --rm migrate node node_modules/@crop/db/dist/invite-cli.js \
  --tenant cfy --name "Caring For You" --email someone@example.com --role owner
```

## Document storage
Bucket `crop-staging-docs` (Spaces, SYD1). The access key (limited to that bucket) is in `/srv/crop/.env` as `SPACES_KEY` / `SPACES_SECRET`. Without them, uploads are refused with "Document storage is not set up yet".

## Email and SMS
Keys in `/srv/crop/.env`: `RESEND_API_KEY` (domain cropwms.com verified in Resend), `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, `CLICKSEND_FROM` (defaults to the dedicated number +61429804977 in compose.yml; set it in .env only to override). Test from the office app: Messages → Email me a test / Text a test.

SMS is live on staging (27 Oct). The ClickSend username is the API username shown on ClickSend's **API Credentials** page (it isn't necessarily the email you log in with). Test a pair without saving it: `curl -s -u "$U:$K" https://rest.clicksend.com/v3/account` should say SUCCESS. Restart the API from a fresh login: values exported in your shell (for example after `. /srv/crop/.env`) override the env file when compose starts the containers.

Without logging in to the server: add `CLICKSEND_USERNAME` and `CLICKSEND_API_KEY` as GitHub repository secrets (Settings → Secrets and variables → Actions). Each deploy copies them into `/srv/crop/.env` (replacing old values) before starting the containers; re-run "Deploy staging" after adding them.
