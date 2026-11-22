import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const readerUrl = "http://127.0.0.1:8787/";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
const serverScript = path.join(projectRoot, "src", "http.js");
const dataDirectory = process.env.READING_MCP_DATA_DIR || path.join(projectRoot, "data");
const noOpen = process.argv.includes("--no-open");

async function serverReady() {
  try {
    const response = await fetch(readerUrl, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await serverReady())) {
  const server = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      READING_MCP_DATA_DIR: dataDirectory,
      READING_HTTP_STDIO: "0",
    },
  });
  server.unref();

  let ready = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await serverReady()) {
      ready = true;
      break;
    }
  }
  if (!ready) process.exit(1);
}

if (!noOpen) {
  const opener = spawn("explorer.exe", [readerUrl], {
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  opener.unref();
}
