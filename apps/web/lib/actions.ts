import { redirect } from 'next/navigation';
import { ApiError } from './api';

/** Runs an API call from a form; on failure returns to the page with the error shown. `success` may be worked out after the call. */
export async function attempt(back: string, fn: () => Promise<unknown>, successText?: string | (() => string)): Promise<never> {
  try {
    await fn();
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err; // Next.js redirect
    const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
  }
  const success = typeof successText === 'function' ? successText() : successText;
  redirect(success ? `${back}${back.includes('?') ? '&' : '?'}done=${encodeURIComponent(success)}` : back);
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};

/** Shows an API error back on the page; lets Next.js redirects (e.g. to sign in) through. */
export function failTo(back: string, err: unknown): never {
  if (err && typeof err === 'object' && 'digest' in err) throw err;
  const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
  redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
}
