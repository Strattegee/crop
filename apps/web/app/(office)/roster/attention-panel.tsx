'use client';

import type { ReactNode } from 'react';

import { ATTENTION_COOKIE } from './view';

/** The Needs attention panel: opens or closes on its heading, and stays as the office left it. */
export function AttentionPanel({ open, summary, children }: { open: boolean; summary: ReactNode; children: ReactNode }) {
  return (
    <details className="card roster-attention" open={open} aria-label="Needs attention"
      onToggle={e => {
        const state = (e.currentTarget as HTMLDetailsElement).open ? 'open' : 'closed';
        document.cookie = `${ATTENTION_COOKIE}=${state}; path=/; max-age=31536000; samesite=lax`;
      }}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
