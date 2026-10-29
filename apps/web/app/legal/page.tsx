import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_DOCS, LEGAL_VERSION } from '../../lib/legal/documents';
import s from './legal.module.css';

export const metadata: Metadata = { title: 'Legal · CROP' };

export default function LegalIndex() {
  return (
    <main className={s.page}>
      <h1 className={s.title}>Legal</h1>
      <p className={s.version}>{LEGAL_VERSION}</p>
      <p className={s.note}>These documents are being finalised. Highlighted text in square brackets is still to be filled in.</p>
      <ul className={s.list}>
        {LEGAL_DOCS.map(d => (
          <li key={d.slug}><Link href={`/legal/${d.slug}`}>{d.title}</Link><div>{d.summary}</div></li>
        ))}
      </ul>
    </main>
  );
}
