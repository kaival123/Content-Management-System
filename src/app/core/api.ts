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

/** Opened from somewhere other than this computer (a deployed copy or another machine on the LAN). */
function hosted(): boolean {
  const h = location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '[::1]' && !/^(10|172|192)\.\d+\.\d+\.\d+$/.test(h);
}

const HOSTED_NO_SERVER =
  'This address only serves the CMS app files — the project server (Node.js) is not running here, so /api has no answer. ' +
  'Run "npm run build" and "npm run serve:prod" on the server (with CMS_ADMIN_PASSWORD set) and point the domain at it. See DEPLOY.md.';

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
    throw new ApiError(0, hosted() ? HOSTED_NO_SERVER : 'Cannot reach the project server. Start it with "npm start".', null);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response: a static host or the dev server answering with a page (no API
    // behind /api), or a proxy error (server down).
    if (hosted()) throw new ApiError(res.status || 502, HOSTED_NO_SERVER, null);
    if (/^\s*<!doctype html/i.test(text)) {
      throw new ApiError(502, 'The dev server is not forwarding /api to the project server. Restart "ng serve" (the proxy is set in angular.json) or use "npm start".', null);
    }
    throw new ApiError(res.status || 502, 'The project server (port 4310) is not running. Start it with "npm run start:server", or use "npm start" to start everything.', null);
  }
  if (res.status === 401 && data?.signIn) window.dispatchEvent(new Event(SIGN_IN_REQUIRED));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
  return data as T;
}
