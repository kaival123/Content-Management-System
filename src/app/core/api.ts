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

/** Fired on window when the server asks to sign in (production mode, session expired). */
export const SIGN_IN_REQUIRED = 'cms:sign-in-required';

/**
 * Calls the local project server (server/index.mjs). Every request carries the
 * X-CMS header the server requires for anything that changes files.
 */
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'X-CMS': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the project server. Start it with "npm start".', null);
  }
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
  if (res.status === 401 && data?.signIn) window.dispatchEvent(new Event(SIGN_IN_REQUIRED));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
  return data as T;
}
