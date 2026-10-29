import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEGAL_DOCS, LEGAL_VERSION } from '../../../lib/legal/documents';
import { LegalBody } from '../legal-body';
import s from '../legal.module.css';

export function generateStaticParams() {
  return LEGAL_DOCS.map(d => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = LEGAL_DOCS.find(d => d.slug === slug);
  return { title: doc ? `${doc.title} · CROP` : 'Legal · CROP' };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = LEGAL_DOCS.find(d => d.slug === slug);
  if (!doc) notFound();
  return (
    <main className={s.page}>
      <div className={s.crumbs}><Link href="/legal">Legal</Link></div>
      <h1 className={s.title}>{doc.title}</h1>
      <p className={s.version}>{LEGAL_VERSION}</p>
      <p className={s.note}>This document is being finalised. Highlighted text in square brackets is still to be filled in.</p>
      <LegalBody markdown={doc.body} />
    </main>
  );
}
