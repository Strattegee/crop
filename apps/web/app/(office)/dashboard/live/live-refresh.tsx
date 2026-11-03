'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { updatedWords } from '../../../../lib/allocation-queue';

const REFRESH_MS = 45_000;

/** Refreshes the live numbers every 45 seconds while the tab is visible, and says when they were last updated. */
export function LiveRefresh({ at }: { at: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    const refresh = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, REFRESH_MS);
    const onShow = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(tick); clearInterval(refresh); document.removeEventListener('visibilitychange', onShow); };
  }, [router]);
  return <span className="muted small live-updated" aria-live="polite"><span className="live-dot" aria-hidden="true" />{updatedWords(Date.parse(at), now)}</span>;
}
