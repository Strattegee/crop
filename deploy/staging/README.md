# Staging deployment

Staging runs on the `crop-staging` droplet (DigitalOcean SYD1, 170.64.173.4) at https://staging.cropwms.com.

- `/` → web app, `/api/*` → API (prefix stripped), `/api/docs` → OpenAPI docs.
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
