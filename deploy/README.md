# Deployment template

These files are generic templates. They intentionally contain no hostname, IP address, user data, or credential.

## Build

Run from the `mcp/` directory:

```bash
docker build -f ../deploy/Dockerfile -t english-co-reading:latest .
```

## Data and environment

```bash
sudo install -d -m 0750 /srv/english-co-reading/data /etc/english-co-reading
sudo cp ../deploy/env.example /etc/english-co-reading/env
sudo chmod 600 /etc/english-co-reading/env
sudoedit /etc/english-co-reading/env
```

Generate a token with `openssl rand -hex 32` and place it in `MCP_AUTH_TOKEN`.

## systemd

```bash
sudo cp ../deploy/english-co-reading.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now english-co-reading
```

The service listens on `127.0.0.1:18792`. Publish it only through an HTTPS reverse proxy or an authenticated Cloudflare Tunnel route. The MCP URL is `https://your-domain.example/mcp`.
