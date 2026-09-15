import { AsyncLocalStorage } from "node:async_hooks";

export const USER_ID_HEADER = "x-co-reading-user";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storage = new AsyncLocalStorage();

export function isMultiuserEnabled() {
  const value = String(process.env.READING_MULTIUSER || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function isValidUserId(value) {
  return UUID_RE.test(String(value || "").trim());
}

export function readUserIdFromRequest(req) {
  const raw = req?.headers?.[USER_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const userId = String(value || "").trim().toLowerCase();
  return isValidUserId(userId) ? userId : null;
}

export function getRequestUserId() {
  return storage.getStore()?.userId || null;
}

export function runWithUser(userId, fn) {
  return storage.run({ userId }, fn);
}
