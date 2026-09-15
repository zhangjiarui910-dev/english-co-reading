const STORAGE_KEY = "co-reading-user-id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const USER_ID_HEADER = "x-co-reading-user";

function readStore(store) {
  try {
    return store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStore(store, value) {
  try {
    store.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode or disabled storage */
  }
}

export function getAnonymousUserId() {
  let id = readStore(localStorage) || readStore(sessionStorage);
  if (!id || !UUID_RE.test(id)) {
    id = crypto.randomUUID();
  }
  id = id.toLowerCase();
  writeStore(localStorage, id);
  writeStore(sessionStorage, id);
  return id;
}

export function parseAnonymousUserId(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) {
    throw new Error("迁移码格式不对，请检查后再试");
  }
  return id;
}

export function restoreAnonymousUserId(raw) {
  const id = parseAnonymousUserId(raw);
  writeStore(localStorage, id);
  writeStore(sessionStorage, id);
  return id;
}

export function userHeaders(extra = {}) {
  return { [USER_ID_HEADER]: getAnonymousUserId(), ...extra };
}
