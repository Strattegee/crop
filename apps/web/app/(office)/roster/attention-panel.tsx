import type { ReactNode } from 'react';

/** The Needs attention panel: closed when the page opens, with its counts on the heading (David, 29 Oct). */
export function AttentionPanel({ open, summary, children }: { open: boolean; summary: ReactNode; children: ReactNode }) {
  return (
    <details className="card roster-attention" open={open} aria-label="Needs attention">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
