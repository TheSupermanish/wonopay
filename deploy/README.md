# Deploy

One small Linux VM runs three containers: `web` (Wono, SQLite on a volume), `store` (the
example store with the x402 API) and `caddy` (HTTPS from Let's Encrypt).

```sh
# 1. Images, built on any machine (the VM is x86_64)
docker buildx build --platform linux/amd64 -f deploy/Dockerfile --target web   -t wono-web   --load .
docker buildx build --platform linux/amd64 -f deploy/Dockerfile --target store -t wono-store --load .

# 2. Copy them to the server
docker save wono-web wono-store | gzip | ssh $SERVER 'gunzip | sudo docker load'

# 3. On the server, next to compose.yaml and Caddyfile, write a root-only .env:
#    WONO_HOST, STORE_HOST, WONO_AURORA_API_KEY, WONO_API_KEY (optional: WONO_SOLANA_FEE_PAYER_SECRET)
sudo docker compose up -d
```

`WONO_HOST` and `STORE_HOST` must resolve to the server before Caddy can get certificates.
A free option for the store: `store.<public-ip>.sslip.io`.

The store needs a merchant key: sign up on the deployed Wono, set the Solana payout
wallet, add `https://$STORE_HOST` to allowed embed origins, create a server API key, put it
in `.env` as `WONO_API_KEY`, then `sudo docker compose up -d store`.

Back up `/var/lib/docker/volumes/*_wono-data`: it holds every invoice and route.
