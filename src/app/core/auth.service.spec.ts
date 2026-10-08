import { AuthService } from './auth.service';

/** Fake fetch Response with just what api() reads. */
function resp(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('AuthService', () => {
  let auth: AuthService;

  beforeEach(() => {
    auth = new AuthService();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts logged out and not ready', () => {
    expect(auth.ready()).toBe(false);
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('init() loads the current user and marks ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, { user: { id: 'u_1', email: 'a@b.com', role: 'user' } })));
    await auth.init();
    expect(auth.ready()).toBe(true);
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.user()?.email).toBe('a@b.com');
    expect(auth.isAdmin()).toBe(false);
  });

  it('init() with no session leaves the user null but ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, { user: null })));
    await auth.init();
    expect(auth.ready()).toBe(true);
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('init() tolerates a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await auth.init();
    expect(auth.ready()).toBe(true);
    expect(auth.user()).toBeNull();
  });

  it('login() stores the returned user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, { user: { id: 'u_2', email: 'admin@b.com', role: 'admin' } })));
    await auth.login('admin@b.com', 'pw');
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.isAdmin()).toBe(true);
  });

  it('login() rejects on bad credentials and stays logged out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(401, { error: 'Wrong email or password' })));
    await expect(auth.login('a@b.com', 'bad')).rejects.toThrow(/wrong email or password/i);
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('register() stores the returned user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, { user: { id: 'u_3', email: 'new@b.com', role: 'user' } })));
    await auth.register('new@b.com', 'pw1234');
    expect(auth.user()?.email).toBe('new@b.com');
  });

  it('changePassword() posts to the account endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await auth.changePassword('old', 'new123');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/password');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ currentPassword: 'old', newPassword: 'new123' });
  });

  it('logout() clears the user even if the request succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, { ok: true })));
    auth.clear();
    await auth.login('a@b.com', 'pw').catch(() => {});
    await auth.logout();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('clear() drops the user without a request', () => {
    auth.clear();
    expect(auth.user()).toBeNull();
  });
});
