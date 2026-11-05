'use client';

import { useState } from 'react';

/** A link with a Copy button (the form's public address). */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="form-row" style={{ alignItems: 'center' }}>
      <input readOnly value={url} aria-label="The form's address" onFocus={e => e.currentTarget.select()} style={{ flex: '1 1 280px' }} />
      <button type="button" className="btn small secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the field can still be selected */ }
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
