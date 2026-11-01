# Self-host thumbz-server on Oracle Cloud Always Free

One Ampere A1 VM (Ubuntu, arm64) runs Redis, a one-shot Prisma migrate, the
API, the BullMQ worker, and Caddy. Postgres stays on Supabase. Railway
(`railway.json`, `railway.worker.json`) and the local `docker-compose.yml`
are unchanged.

The image is built **on the VM**. `prisma generate` runs inside that build,
so the query engine matches Debian 12 arm64 (`linux-arm64-openssl-3.0.x`).
`schema.prisma` does not pin `binaryTargets`. `node:22-bookworm-slim`,
`redis:7-alpine`, and `caddy:2-alpine` all publish `linux/arm64`.

## Only you can do these

An agent cannot sign up, create the instance, or see your secrets.

1. Create the Oracle account (card verification) and note the **home region**.
2. Create the VM, the VCN rules, and a reserved public IPv4.
3. Point DNS at that IP (your domain, DuckDNS, sslip.io, or a Cloudflare Tunnel).
4. Copy Railway's env into `deploy/oracle/.env`. Do not commit that file.
5. In the Xendit dashboard, set the webhook URL to the new `PUBLIC_API_URL`.
6. On the Next.js project, set `NEXT_PUBLIC_API_URL` to the new origin and redeploy the client.
7. Optional: add the GitHub Actions secrets listed below.
8. After the new origin serves `/health` and websockets, shut the Railway services down.

## What runs

| Service   | Role                                      | Published                         |
| --------- | ----------------------------------------- | --------------------------------- |
| `redis`   | Cache, rate limits, BullMQ, Socket.IO    | No. `redis:6379` on the data network only |
| `migrate` | `prisma migrate deploy`, then it exits   | No                                |
| `api`     | `node dist/main.js`, port 3001            | No, except loopback in tunnel mode |
| `worker`  | `node dist/worker.js`                     | No                                |
| `caddy`   | HTTPS for `API_DOMAIN`, including websockets | TCP 80 and 443                 |

Steady RAM caps: Redis 512 MB, API 768 MB, worker 512 MB, Caddy 128 MB
(about 1.9 GB). Redis `maxmemory` is 384 MB with `noeviction`, so a full
Redis returns errors instead of deleting BullMQ jobs. Logs rotate at 10 MB
× 3 files. The API and worker restart `unless-stopped`. Migrate does not
restart.

`TRUST_PROXY` is **not** forced by Compose. Set it in `.env` (see below).
`REDIS_URL`, `PORT`, and `NODE_ENV` **are** forced for the API and worker
so a pasted Railway Redis URL cannot win.

## 1. Shape, and what to do when capacity is gone

Always Free Ampere quota, for the life of the account, is **4 OCPUs and
24 GB RAM** in total (3,000 OCPU-hours and 18,000 GB-hours per month). Use
part of it:

| | OCPUs | RAM | When |
| --- | --- | --- | --- |
| Comfortable | 2 | 12 GB | Default. Image builds fit. Bootstrap does not add swap. |
| Tight | 1 | 6 GB | Use this when the region has no room for 12 GB. Bootstrap adds 2 GB swap so the image build has somewhere to spike. |

- Shape: `VM.Standard.A1.Flex`.
- Image: **Canonical Ubuntu 22.04 or 24.04, aarch64**. Not an x86 image.
- Boot volume: 50 GB works if you prune images. 80 GB is calmer and still
  inside the 200 GB Always Free block-volume allowance.
- Put the instance in a **public subnet** and assign a public IPv4. After
  it exists, reserve that address (Reserved public IP) so a rebuild does
  not change DNS.

**Always Free compute is free in the account's home region.** Creating this
shape in another region can be billed. Stay in the home region.

`Out of host capacity` is normal in busy home regions. Still in the home
region, in order:

1. Try each availability domain.
2. Drop to 1 OCPU / 6 GB.
3. Retry later. Capacity moves. Do not script-hammer the API.
4. Do not "just pick another region" unless you mean to pay.

## 2. Let the internet reach 80 and 443

Oracle has two doors, and both start closed for HTTP.

**Cloud door.** On the subnet security list, add stateful ingress:

| Source    | Protocol | Port |
| --------- | -------- | ---- |
| your IP/32 | TCP     | 22   |
| 0.0.0.0/0 | TCP      | 80   |
| 0.0.0.0/0 | TCP      | 443  |

Leave the default egress allow-all. The VM has to reach Docker Hub,
Supabase, Let's Encrypt, and the payment APIs. If the VNIC has a network
security group, open the same ports there. A security list that allows 443
does nothing while an NSG still allows only 22.

**Host door.** Ubuntu images from Oracle accept SSH in iptables and
`REJECT` everything else, then restore that file on boot. Opening the
security list is not enough. `bootstrap.sh` inserts accepts for TCP 80 and
443 **above** that REJECT, writes them into `/etc/iptables/rules.v4` and
`rules.v6` (originals kept as `*.bak-thumbz`), and installs
`thumbz-firewall.service` so the rules come back after Docker starts.
It does not enable UFW. Oracle's images leave UFW off on purpose.

Check later with `sudo iptables -S INPUT`. You want ACCEPT lines for dports
80 and 443 before the REJECT.

## 3. A hostname

Caddy gets a Let's Encrypt certificate for `API_DOMAIN` over HTTP-01.
That only works if the name resolves to this VM and something on the
internet can open port 80. Set DNS **before** the first deploy if you can.
The deploy script itself only checks `/health/live` inside the API
container, so a deploy can succeed before the certificate exists. Caddy
retries until DNS and port 80 work. Certificates live in the `caddy-data`
volume, so a redeploy does not ask Let's Encrypt again.

Pick one.

### Your own domain

An A record, for example `api.example.com`, to the reserved public IP.
Leave Cloudflare's proxy **off** (DNS only) for this path. An orange-cloud
proxy hides the VM from Let's Encrypt's HTTP-01 check, and it is a second
proxy hop (`TRUST_PROXY=2`, see the env file).

### DuckDNS

Free account, one subdomain, point it at the public IP (their web form or
the update URL). `API_DOMAIN=your-name.duckdns.org`.

### sslip.io

No signup. For public IP `140.238.1.2` the hostname is
`140.238.1.2.sslip.io`. It keeps working only while that IP stays. A
reserved IP is what makes this stable. Fine as a stopgap, awkward as the
long-term payment callback URL because the IP is in the name.

### Cloudflare Tunnel

Use this when you do not want 80/443 open at all. TLS ends at Cloudflare,
which proxies websockets on the free plan. Skip the security-list rules
for 80/443 (keep SSH). In `.env` set `ORACLE_TUNNEL=1` and `TRUST_PROXY=1`.
`deploy.sh` then uses `compose.tunnel.yaml`: Caddy is not started, and the
API is published on `127.0.0.1:3001` only.

You create the named tunnel in Cloudflare Zero Trust (that account is
yours). On the VM:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
sudo cloudflared service install <tunnel-token>
```

The tunnel's public hostname should target `http://127.0.0.1:3001`.
`PUBLIC_API_URL` is `https://` that hostname. A quick
`cloudflared tunnel --url http://127.0.0.1:3001` trycloudflare name changes
every run. Do not put a trycloudflare URL in `PUBLIC_API_URL`.

## 4. Bootstrap

SSH in as `ubuntu` (the user on Canonical's image).

```bash
sudo apt-get update
sudo apt-get install -y git
sudo mkdir -p /opt/thumbz
sudo chown "$USER:$USER" /opt/thumbz
git clone <this-repo-url> /opt/thumbz/thumbz-server
cd /opt/thumbz/thumbz-server
git checkout dev    # or main, once this kit is merged and you want that branch
sudo bash deploy/oracle/bootstrap.sh
```

Log out and back in so the `docker` group applies. Running bootstrap again
is safe.

A private GitHub repo needs a read-only deploy key on this VM
(`~/.ssh/id_ed25519`, no passphrase, added to the repo's deploy keys)
before `git clone` / `git pull` will work unattended.

## 5. Fill in the env

```bash
cp deploy/oracle/.env.example deploy/oracle/.env
chmod 600 deploy/oracle/.env
nano deploy/oracle/.env
```

Copy the secret values from the Railway API service. Then change the
Oracle-specific ones:

| Variable | Value on this VM |
| --- | --- |
| `API_DOMAIN` | Hostname only, no scheme. `api.example.com` |
| `ACME_EMAIL` | An email Let's Encrypt can write to |
| `PUBLIC_API_URL` | `https://` plus `API_DOMAIN`, no trailing slash |
| `CORS_ORIGINS` | The Next.js origin, e.g. `https://thumbz-next-client.vercel.app` |
| `FRONTEND_URL` | Same origin, used for payment return pages |
| `TRUST_PROXY` | `1` behind Caddy, or behind cloudflared. `2` if Cloudflare's proxy sits in front of Caddy |
| `REDIS_URL` | `redis://redis:6379` (Compose sets this again on the API and worker) |
| `DATABASE_URL` | Supabase **session pooler**, port **5432**, with `?pgbouncer=true&connection_limit=4`. Not port 6543. Not `db.<ref>.supabase.co` (IPv6-only; this VM often has no IPv6) |
| `TICKET_SIGNING_SECRET` | `openssl rand -base64 32` |
| `DRM_MASTER_KEY` | `openssl rand -hex 32` (64 hex chars). The API refuses to boot in production without it |
| `PLAYBACK_TOKEN_SECRET` | `openssl rand -base64 32` |

If the database password contains `$`, write `$$` in this file. Compose
interpolates `$`.

`METRICS_TOKEN` empty means anyone who can open the API hostname can scrape
`GET /metrics`. Set 16 or more random characters.

`LIVE_SIMULATOR=true` and `PAYMENTS_SANDBOX=true` match the current Railway
portfolio demo. A real shop sets both to `false`.

Generate the three required secrets on the VM if Railway does not already
have them. Reuse the Railway values if you want old ticket QR codes and
playback tokens to keep verifying.

## 6. First deploy

```bash
bash deploy/oracle/deploy.sh
```

That fetches the current branch, fast-forwards, tags the previous image
as `thumbz-server:rollback` (no-op the first time), builds
`thumbz-server:oracle`, recreates the stack, and waits until
`/health/live` inside the API container returns 200. Migrate runs and
exits before the API or the worker start. `prisma migrate deploy` only
applies pending migrations.

Then:

```bash
bash deploy/oracle/logs.sh          # all services, follow
bash deploy/oracle/logs.sh api      # one service
bash deploy/oracle/logs.sh caddy
```

## 7. Prove HTTPS and websockets

Replace the host with `API_DOMAIN`.

```bash
curl -fsS "https://api.example.com/health"
curl -fsS "https://api.example.com/health/live"
curl -fsS "https://api.example.com/socket.io/?EIO=4&transport=polling"
```

`/health` and `/health/live` return JSON with `"status":"ok"`. `/health`
also checks Supabase and Redis (`/health/live` does not). The Socket.IO
poll should answer with a body starting `0{`. That is Engine.IO saying the
HTTP path through Caddy works, which is the same path the WebSocket upgrade
uses. The client connects with `io("https://api.example.com/rt")` (path
`/socket.io`, namespace `/rt`).

From a laptop, a failed `curl` to 443 with "no route to host" or a timeout
is almost always the security list, the NSG, or the iptables REJECT. DNS
errors and certificate errors are Caddy's log (`logs.sh caddy`).

## 8. Updates and rollback

```bash
bash deploy/oracle/deploy.sh
```

Or push to `main` after the GitHub Action below is configured. The script
deploys whatever branch is checked out, unless you set `DEPLOY_BRANCH`.

```bash
bash deploy/oracle/rollback.sh
```

This points `thumbz-server:oracle` back at the image tagged before the last
build and recreates the API and the worker. It does not run a down
migration. If the new deploy's migrate step already committed a migration,
the old image has to work against that schema. The git checkout is left
where it is. The script prints the commit that was running before the
deploy. A reboot does not rebuild: `unless-stopped` brings the restored
containers back.

To ship that older commit for real, check it out on a branch and run
`deploy.sh` again. The next `deploy.sh` on `main` will build `main`.

Redis updates are not part of the app build:

```bash
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml pull redis caddy
docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml up -d redis caddy
```

## 9. Optional: deploy on push to main

`.github/workflows/deploy-oracle.yml` runs on a push to `main` and on
manual dispatch. If `ORACLE_SSH_HOST`, `ORACLE_SSH_USER`, or
`ORACLE_SSH_KEY` is unset, the workflow records a notice and skips the
SSH job. It does not fail, and it is a different workflow from CI.

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ORACLE_SSH_HOST` | Public IP or hostname |
| `ORACLE_SSH_USER` | `ubuntu` |
| `ORACLE_SSH_KEY` | Private key PEM, no passphrase. A key that can `git pull` is a different key, on the VM |
| `ORACLE_SSH_PORT` | Optional. Default 22 |
| `ORACLE_SSH_KNOWN_HOSTS` | Optional. One line from `ssh-keyscan -p 22 <ip>` so the runner does not use accept-new |

Optional variable `ORACLE_DEPLOY_PATH` (default
`/opt/thumbz/thumbz-server`). The VM must already have the clone, the
`.env`, and a `git pull` that works for `main`. The action runs
`DEPLOY_BRANCH=main bash deploy/oracle/deploy.sh`.

## 10. Cut over from Railway

Do this only after section 7 passes. Order matters because payment
providers call the URL that was current when the invoice was created.

1. Leave Railway up until the new origin is healthy.
2. Client: set `NEXT_PUBLIC_API_URL` to `https://<API_DOMAIN>` and redeploy
   the Next.js app. Socket.IO uses that same origin (`/rt` on `/socket.io`).
   If the client has a separate socket URL, point it at the same origin.
3. Server `.env`: `CORS_ORIGINS` and `FRONTEND_URL` must be the client
   origin the browser actually uses. Restart is included in `deploy.sh`
   (`bash deploy/oracle/deploy.sh`) after you edit `.env`.
4. `REVALIDATE_SECRET` must still match the Vercel project, or on-demand
   revalidation stops.
5. Xendit dashboard → Webhooks: set the URL to
   `https://<API_DOMAIN>/api/v1/webhooks/xendit`. The API checks
   `x-callback-token` against `XENDIT_CALLBACK_TOKEN`. The code does not
   send a per-payment callback URL.
6. NOWPayments: new invoices send `ipn_callback_url`
   `https://<API_DOMAIN>/api/v1/webhooks/nowpayments`, taken from
   `PUBLIC_API_URL` at create time. Invoices already created still call
   Railway until they expire (holds are 30 minutes). Keep the same
   `NOWPAYMENTS_IPN_SECRET`.
7. DRM playback and license URLs are also built from `PUBLIC_API_URL`.
   Old pages that cached the Railway host need the new client deploy.
8. Watch `bash deploy/oracle/logs.sh api` through one real or sandbox
   payment and one websocket session (a live match page).
9. Stop the Railway API, the Railway worker, and the Railway Redis.
   Do not delete the Supabase project. The database never moved.

## Troubleshooting

**`curl` to 443 times out, container logs look fine.** Security list, NSG,
or iptables. `sudo bash deploy/oracle/open-web-ports.sh` is safe to repeat.
`sudo iptables -S INPUT` should list 80 and 443 before REJECT.

**Caddy restart loop, certificate errors.** `API_DOMAIN` must be a bare
hostname. DNS must point here. Port 80 must be open. Cloudflare orange-cloud
breaks HTTP-01. Let's Encrypt rate-limits failed authorizations (about 5
per hostname per hour). The cert cache is the `caddy-data` volume; don't
`docker compose down -v`.

**API exits immediately with `Invalid environment configuration`.** A
required production variable is empty or wrong. `TICKET_SIGNING_SECRET`,
`PLAYBACK_TOKEN_SECRET` (32+ chars), and `DRM_MASTER_KEY` (64 hex chars)
are the usual ones. `bash deploy/oracle/logs.sh api` prints the list.

**`Can't reach database` / IPv6.** Use the session-pooler URI on port 5432.
The direct host is IPv6-only on current Supabase projects.

**Prisma `could not locate the Query Engine`.** The image was built on the
wrong architecture. On the VM, `bash deploy/oracle/deploy.sh` rebuilds it
natively. Do not copy an amd64 image onto this box.

**Redis `OOM command not allowed`.** Expected with `noeviction` when the
384 MB cap is hit. Set `REDIS_MAXMEMORY=768mb` (and raise the `mem_limit`
on the redis service above that) and redeploy. Do not switch the policy
to `allkeys-lru`. That deletes queue data.

**Disk full during build.** `docker image prune -f` and
`docker builder prune -f`. The boot volume can be grown in the Oracle
console without rebuilding the instance.

**Rollback booted, then the next deploy brought the bad commit back.**
`rollback.sh` restores the image only. `deploy.sh` builds the commit you
have checked out.
