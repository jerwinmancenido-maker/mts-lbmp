import { appendDiagnosticLog } from "./cache";

/**
 * The session JWT lives ONLY in this module variable (Phase 5 audit §6:
 * never localStorage/cookies, so nothing persists for XSS to steal and a
 * page reload ends the session). Phase 5 P5-2 removed the built-in
 * default demo token — the shell starts signed OUT and the login screen
 * is the only entry; setApiToken is called with the real token issued by
 * POST /auth/login or /auth/staff-code.
 */
let authToken = "";

export function setApiToken(token: string) {
  authToken = token;
}

/** Logout: drop the in-memory token. The next API call is unauthenticated. */
export function clearApiToken() {
  authToken = "";
}

export function hasApiToken() {
  return authToken.length > 0;
}

export interface ApiWriteOptions {
  /**
   * Phase 4 B1: stable key for one user intent (the offline queue record's
   * id, or a per-intent id for direct submits). Sent as the `Idempotency-Key`
   * header; the API returns the original result for a repeat key instead of
   * applying the write twice.
   */
  idempotencyKey?: string;
}

function headers(options?: ApiWriteOptions) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
    ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
  };
}

function apiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:4100`;
  return "http://localhost:4100";
}

export async function apiGet<T>(path: string): Promise<T> {
  try {
    const response = await fetch(`${apiUrl()}${path}`, { cache: "no-store", headers: headers() });
    if (!response.ok) {
      const errorText = await response.text();
      void appendDiagnosticLog({ level: "error", source: "api", message: `GET ${path} failed`, details: { status: response.status, errorText } });
      throw new Error(errorText);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    void appendDiagnosticLog({ level: "error", source: "api", message: `GET ${path} error`, details: error });
    throw error;
  }
}

export async function apiPost<T>(path: string, body?: unknown, options?: ApiWriteOptions): Promise<T> {
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      method: "POST",
      headers: headers(options),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const errorText = await response.text();
      void appendDiagnosticLog({ level: "error", source: "api", message: `POST ${path} failed`, details: { status: response.status, errorText, body } });
      throw new Error(errorText);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    void appendDiagnosticLog({ level: "error", source: "api", message: `POST ${path} error`, details: { error, body } });
    throw error;
  }
}

export async function apiPatch<T>(path: string, body?: unknown, options?: ApiWriteOptions): Promise<T> {
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      method: "PATCH",
      headers: headers(options),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const errorText = await response.text();
      void appendDiagnosticLog({ level: "error", source: "api", message: `PATCH ${path} failed`, details: { status: response.status, errorText, body } });
      throw new Error(errorText);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    void appendDiagnosticLog({ level: "error", source: "api", message: `PATCH ${path} error`, details: { error, body } });
    throw error;
  }
}
