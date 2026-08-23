// apps/web/src/store/configStore.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConfigStore } from './configStore';

function mockFetchOnce(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body ?? {}), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  useConfigStore.setState({
    authToken: null,
    role: null,
    tokenError: null,
    isTokenModalOpen: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitAuthToken', () => {
  it('accepts admin token and stores role', async () => {
    mockFetchOnce(200, { data: { role: 'admin', demoMode: false } });
    await useConfigStore.getState().submitAuthToken('admin-tok');
    const s = useConfigStore.getState();
    expect(s.authToken).toBe('admin-tok');
    expect(s.role).toBe('admin');
    expect(s.isTokenModalOpen).toBe(false);
    expect(s.tokenError).toBeNull();
  });

  it('accepts demo token and stores demo role', async () => {
    mockFetchOnce(200, { data: { role: 'demo', demoMode: true } });
    await useConfigStore.getState().submitAuthToken('demo-tok');
    const s = useConfigStore.getState();
    expect(s.authToken).toBe('demo-tok');
    expect(s.role).toBe('demo');
  });

  it('rejects invalid token with 401 and flags error', async () => {
    mockFetchOnce(401);
    await useConfigStore.getState().submitAuthToken('bad');
    const s = useConfigStore.getState();
    expect(s.authToken).toBeNull();
    expect(s.tokenError).toBe('令牌无效，请重试');
  });

  it('flags network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')));
    await useConfigStore.getState().submitAuthToken('any');
    expect(useConfigStore.getState().tokenError).toBe('网络错误，无法验证令牌');
  });

  it('does not clobber an existing valid token on failed resubmission', async () => {
    useConfigStore.setState({ authToken: 'valid-tok', role: 'admin', isTokenModalOpen: false });
    mockFetchOnce(401);
    await useConfigStore.getState().submitAuthToken('bad-guess');
    const s = useConfigStore.getState();
    expect(s.authToken).toBe('valid-tok');
    expect(s.role).toBe('admin');
    expect(s.tokenError).toBe('令牌无效，请重试');
  });
});

describe('clearAuthToken', () => {
  it('resets role and reopens modal', () => {
    useConfigStore.setState({ authToken: 'x', role: 'demo', isTokenModalOpen: false });
    useConfigStore.getState().clearAuthToken();
    const s = useConfigStore.getState();
    expect(s.authToken).toBeNull();
    expect(s.role).toBeNull();
    expect(s.isTokenModalOpen).toBe(true);
  });
});
