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

## Sign-in and giving people access

Add to `/srv/crop/.env`, then redeploy (or `docker compose ... up -d api`):
```
AUTH_ISSUER=https://<instance>.zitadel.cloud
AUTH_AUDIENCE=<Zitadel project ID>
```

Invite someone to an agency (creates the agency if it doesn't exist). They get access the first time they sign in with that email, once Zitadel has verified it:
```sh
cd /srv/crop/app/deploy/staging
docker compose --env-file /srv/crop/.env run --rm migrate node node_modules/@crop/db/dist/invite-cli.js \
  --tenant cfy --name "Caring For You" --email someone@example.com --role owner
```
Roles: owner, admin, allocator, worker, client.
