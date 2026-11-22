# Security

English Co-Reading stores imported books, annotations, practice records, and learning history. Treat the data directory as private.

- Never commit `MCP_AUTH_TOKEN`, `.env` files, server credentials, imported books, or runtime JSON/JSONL files.
- Remote deployments must use HTTPS and a strong bearer token.
- Bind the application to localhost when using a reverse proxy or Cloudflare Tunnel.
- Rotate the bearer token immediately if it appears in logs, screenshots, chat messages, or version control.
- Review tool calls before allowing write access from an MCP client.

For security reports, open a private GitHub security advisory rather than a public issue.
