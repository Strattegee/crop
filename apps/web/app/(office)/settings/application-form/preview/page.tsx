import Link from 'next/link';
import { api } from '../../../../../lib/api';
import type { ApplyView } from '../../../../../lib/apply';
import { ApplyForm } from '../../../../apply/[slug]/apply-form';

export const dynamic = 'force-dynamic';

/** Settings › Application form › Preview: the form exactly as applicants see it, open or not; nothing can be sent. */
export default async function ApplyPreviewPage() {
  const view = await api<ApplyView>('/apply-form/preview');
  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> › <Link href="/settings/application-form">Application form</Link> ›</p>
      <h1>Preview</h1>
      <section className="card" style={{ maxWidth: 720 }}>
        <p className="muted" style={{ margin: 0 }}>{view.business}</p>
        <h2 style={{ marginTop: 4 }}>Apply to work with us</h2>
        {view.intro && <p style={{ whiteSpace: 'pre-line' }}>{view.intro}</p>}
        <ApplyForm view={view} preview />
      </section>
    </>
  );
}
