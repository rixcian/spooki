import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError, onUnauthorized } from './api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api', () => {
  it('returns JSON on success', async () => {
    const fetchMock = stubFetch(200, { messages: [], busy: false });
    expect(await api.messages()).toEqual({ messages: [], busy: false });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messages');
  });

  it('throws ApiError with the server message', async () => {
    stubFetch(409, { error: 'A reply is already in progress' });
    await expect(api.getSettings()).rejects.toEqual(new ApiError(409, 'A reply is already in progress'));
  });

  it('calls the unauthorized handler on 401, except for login', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    stubFetch(401, { error: 'Unauthorized' });
    await expect(api.messages()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    stubFetch(401, { error: 'Wrong password' });
    await expect(api.login('x')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
