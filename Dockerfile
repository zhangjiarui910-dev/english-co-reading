FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json requirements.txt ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt \
  && mkdir -p /var/data/users

ENV NODE_ENV=production
ENV MCP_SSE_HOST=0.0.0.0
ENV READING_MCP_DATA_DIR=/var/data
ENV READING_PYTHON=python3
ENV READING_MULTIUSER=1

EXPOSE 3100

CMD ["node", "scripts/start-hosted.mjs"]
