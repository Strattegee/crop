import Link from 'next/link';

/** Links to the privacy policy and legal documents, for public and signed-out pages. */
export function LegalFooter() {
  return (
    <p style={{ marginTop: 32, fontSize: 13, color: 'var(--muted)' }}>
      <Link href="/legal/privacy" style={{ color: 'inherit' }}>Privacy</Link>
      {' · '}
      <Link href="/legal" style={{ color: 'inherit' }}>Legal</Link>
    </p>
  );
}
