#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hostedDataDir = path.resolve(root, "data-hosted");

process.env.READING_MCP_DATA_DIR ||= hostedDataDir;
process.env.MCP_SSE_HOST ||= "0.0.0.0";
process.env.READING_PYTHON ||= "python3";
process.env.READING_MULTIUSER ||= "1";

await mkdir(path.join(process.env.READING_MCP_DATA_DIR, "users"), { recursive: true });

const child = spawn(process.execPath, [path.join(root, "src", "server-sse.js")], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
