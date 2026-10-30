import { freshToken } from './auth';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class SignedOut extends Error {}

/** Calls the CROP API as the signed-in person. `tenant` is the business's slug when they belong to several. */
export async function api<T>(path: string, opts: { method?: string; tenant?: string | null } = {}): Promise<T> {
  const token = await freshToken();
  if (!token) throw new SignedOut('Please sign in again');
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (opts.tenant) headers['x-tenant'] = opts.tenant;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers });
  } catch {
    throw new ApiError("Can't reach CROP. Check your connection and try again.", 0);
  }
  if (res.status === 401) throw new SignedOut('Please sign in again');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (body as { message?: unknown }).message;
    throw new ApiError(typeof m === 'string' ? m : Array.isArray(m) ? m.join('. ') : 'Something went wrong. Please try again.', res.status);
  }
  return body as T;
}
