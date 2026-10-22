import { redirect } from 'next/navigation';
import { ApiError } from './api';

/** Runs an API call from a form; on failure returns to the page with the error shown. */
export async function attempt(back: string, fn: () => Promise<unknown>, success?: string): Promise<never> {
  try {
    await fn();
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err; // Next.js redirect
    const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
  }
  redirect(success ? `${back}${back.includes('?') ? '&' : '?'}done=${encodeURIComponent(success)}` : back);
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};
