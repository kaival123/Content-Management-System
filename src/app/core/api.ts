/** Error from the project server, keeping the status and any extra fields (e.g. conflicts). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: any,
  ) {
    super(message);
  }
}

/** Called when the server reports the session is gone (401), so the app can show the login screen. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

/** When an admin is viewing another user's project, their id is sent on every request. */
let actingAsId: string | null = null;
export function setActingAs(id: string | null): void {
  actingAsId = id;
}
/** Query suffix for the EventSource URL (which can't send headers). */
export function actingAsQuery(): string {
  return actingAsId ? `?as=${encodeURIComponent(actingAsId)}` : '';
}

/**
 * Calls the project server (server/index.mjs). Every request carries the X-CMS header
 * the server requires for writes, and the session cookie (credentials) for auth.
 */
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        'X-CMS': '1',
        ...(actingAsId ? { 'X-CMS-As': actingAsId } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the project server. Start it with "npm start".', null);
  }
  // A lost/expired session on any call except the auth probes sends the user back to login.
  if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized?.();
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response: the dev server's own HTML (no /api proxy) or a proxy error (server down).
    if (/^\s*<!doctype html/i.test(text)) {
      throw new ApiError(502, 'The dev server is not forwarding /api to the project server. Restart "ng serve" (the proxy is set in angular.json) or use "npm start".', null);
    }
    throw new ApiError(res.status || 502, 'The project server (port 4310) is not running. Start it with "npm run start:server", or use "npm start" to start everything.', null);
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
  return data as T;
}
