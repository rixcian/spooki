// Explicit field, not a constructor parameter property: the Vite template enables
// `erasableSyntaxOnly`, which rejects parameter properties.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  source: 'chat' | 'cron';
  content: string;
  status: 'complete' | 'error';
  cronJob: string | null;
  createdAt: string;
}

export interface SettingsView {
  hermesUrl: string;
  urlSource: 'settings' | 'env';
  apiKeySet: boolean;
  apiKeyLast4: string | null;
  keySource: 'settings' | 'env';
}

export type TestResult = { ok: true; models: string[] } | { ok: false; error: string };

let unauthorizedHandler: () => void = () => {};
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}
export function notifyUnauthorized(): void {
  unauthorizedHandler();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') notifyUnauthorized();
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

export const api = {
  me: () => request<{ authenticated: boolean }>('/auth/me'),
  login: (password: string) => request('/auth/login', json('POST', { password })),
  logout: () => request('/auth/logout', json('POST')),
  messages: () => request<{ messages: Message[]; busy: boolean }>('/messages'),
  stopChat: () => request<{ stopped: boolean }>('/chat/stop', json('POST')),
  getSettings: () => request<SettingsView>('/settings'),
  saveSettings: (s: { hermesUrl?: string; hermesApiKey?: string }) => request<SettingsView>('/settings', json('PUT', s)),
  resetSettings: () => request<SettingsView>('/settings', json('DELETE')),
  testConnection: () => request<TestResult>('/settings/test', json('POST')),
  vapidKey: () => request<{ publicKey: string }>('/push/vapid-public-key').then((r) => r.publicKey),
  subscribe: (sub: PushSubscriptionJSON) => request('/push/subscribe', json('POST', sub)),
};
