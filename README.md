# English Co-Reading

English Co-Reading is a private-by-default English reading and review system for Codex, Claude, and other MCP clients. It combines an original-text reader, exact sentence-level progress, confirmed speech practice, vocabulary review, anchored notes, and privacy-safe exports.

This repository contains the reusable plugin and server code only. It does **not** contain the author's books, learning history, notes, credentials, deployment hostname, or server address.

## Highlights

- Resume at an exact sentence with stable text anchors and re-import recovery.
- Keep vocabulary, phrases, translations, retellings, feedback, and spaced-review state.
- Confirm speech-to-text drafts before they become formal learner-error records.
- Separate explanations into Literal meaning, Natural Chinese, and Context / literary inference.
- Add highlights, private notes, and durable “Send to Codex” inbox messages.
- Import EPUB, text-based PDF, TXT, and Markdown books.
- Use a readable review notebook instead of raw JSONL.
- Export privacy-safe Markdown, HTML, and share-card previews.
- Run locally over stdio/HTTP or remotely over authenticated MCP HTTPS.

## Repository layout

```text
.codex-plugin/                 Codex plugin manifest
skills/english-co-reading/     Codex skill instructions
mcp/src/                       MCP, HTTP, and learning-system server
mcp/public/                    Review notebook and original-text reader
mcp/scripts/                   Import, migration, and smoke-test scripts
deploy/                        Generic Docker and systemd templates
```

## Local plugin use

Node.js 18 or newer is required. Install or link this directory as a personal Codex plugin, restart Codex, and start a new chat. The bundled `.mcp.json` launches `mcp/src/http.js`.

By default, personal data is stored outside the repository in:

```text
~/Documents/English Co-Reading
```

You can override that location with `READING_MCP_DATA_DIR`.

## Standalone local server

```bash
cd mcp
READING_MCP_DATA_DIR="$HOME/Documents/English Co-Reading" npm run reader
```

Open `http://127.0.0.1:8787/` for the review notebook or `http://127.0.0.1:8787/reader.html` for the reader.

## Remote MCP deployment

Never expose the server without HTTPS and a strong bearer token.

```bash
cd mcp
MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
READING_MCP_DATA_DIR=/srv/english-co-reading/data \
npm run start:sse
```

The preferred remote connector endpoint is:

```text
https://your-domain.example/mcp
```

Configure the MCP client with a fixed request header:

```text
Authorization: Bearer <your-token>
```

For a container deployment, build from the MCP directory:

```bash
docker build -f ../deploy/Dockerfile -t english-co-reading:latest .
```

The sample systemd service binds the container to `127.0.0.1:18792`; place a TLS reverse proxy or Cloudflare Tunnel in front of it. See [`deploy/README.md`](deploy/README.md).

## Tests

From `mcp/`:

```bash
node scripts/english-smoke.mjs
node scripts/learning-system-smoke.mjs
node scripts/smoke.mjs
```

## Privacy

Runtime data, imported books, uploads, exports, backups, secrets, and `.env` files are ignored by Git. Before publishing a fork, run a secret scan and confirm that no copyrighted books or private learning records have been added.

## Attribution

English Co-Reading is based on the MIT-licensed `idleprocesscc/co-reading-mcp` project and extends it with a long-term English-learning workflow, exact resume, speech confirmation, review tools, and a richer reader interface. See [`mcp/LICENSE`](mcp/LICENSE).
