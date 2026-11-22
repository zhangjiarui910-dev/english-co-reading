FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

ENV NODE_ENV=production \
    READING_PYTHON=python3 \
    READING_MCP_DATA_DIR=/data \
    MCP_SSE_HOST=0.0.0.0 \
    MCP_SSE_PORT=3100

EXPOSE 3100
CMD ["node", "src/server-sse.js"]
