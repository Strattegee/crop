import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LegalFooter } from '../../../lib/legal/legal-footer';
import { untilDay, uploadLink } from '../../../lib/upload-link';

export const dynamic = 'force-dynamic';
// The link is the person's key: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: 'Send your documents · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/heic,image/heif';

/**
 * Upload link page (approved by David 29 Oct): the person sends photos or files of what's still needed without
 * signing in. Opening the page changes nothing; each form posts. Everything sent waits for the office to check it.
 */
export default async function UploadPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;
  const r = await uploadLink(token);
  const back = `/upload/${encodeURIComponent(token)}`;

  async function send(formData: FormData) {
    'use server';
    const path = formData.get('kind') === 'rtw' ? 'right-to-work' : 'credentials';
    const label = String(formData.get('label') ?? 'That');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) redirect(`${back}?error=${encodeURIComponent('Choose a photo or file to send')}`);
    const form = new FormData();
    for (const k of ['credentialTypeId', 'number', 'issueDate', 'expiryDate']) {
      const v = formData.get(k);
      if (typeof v === 'string' && v.trim()) form.set(k, v.trim());
    }
    form.set('file', file as File, (file as File).name);
    const res = await uploadLink(token, { path, form });
    redirect(res.ok ? `${back}?done=${encodeURIComponent(`Thanks, ${label} has been sent. The office will check it.`)}` : `${back}?error=${encodeURIComponent(res.message)}`);
  }

  if (!r.ok) {
    return (
      <main className="offer-page">
        <p className="offer-brand">CROP</p>
        <section className="card"><h1>Send your documents</h1><p>{r.message}</p></section>
        <LegalFooter />
      </main>
    );
  }
  const v = r.view;
  return (
    <main className="offer-page upload-page">
      <p className="offer-brand">CROP</p>
      <section className="card">
        <p className="muted" style={{ margin: 0 }}>{v.business}</p>
        <h1 style={{ marginTop: 4 }}>Hi {v.firstName}</h1>
        {v.state !== 'ok' ? (
          <p>{v.state === 'expired' ? `This link has run out. Ask ${v.business} to send you a new one.` : `This link has been replaced by a newer one. Use the link in your latest message from ${v.business}.`}</p>
        ) : (<>
          <p>Send a clear photo or scan of each of these. {v.business} will check them before they count. This link is just for you and works until {untilDay(v.expiresAt)}.</p>
          {done && <p className="notice">{done}</p>}
          {error && <p className="notice error">{error}</p>}
        </>)}
      </section>

      {v.state === 'ok' && v.items.map(i => (
        <section key={i.credentialTypeId} className="card upload-item">
          <h2>{i.typeName} {i.required ? <span className="badge bad">Needed</span> : <span className="badge neutral">Would help</span>}</h2>
          {i.sent && <p className="muted" style={{ marginTop: 0 }}>Sent: {i.sent.files} {i.sent.files === 1 ? 'file' : 'files'}, waiting to be checked. You can add another (for example the back of a card).</p>}
          <form action={send} className="form-row">
            <input type="hidden" name="credentialTypeId" value={i.credentialTypeId} />
            <input type="hidden" name="label" value={i.typeName} />
            {!i.sent && i.hasNumber && <label>Number<input name="number" required maxLength={100} /></label>}
            {!i.sent && i.hasExpiry && <label>Expiry date<input name="expiryDate" type="date" required /></label>}
            {!i.sent && <label>Issue date <span className="muted">(if shown)</span><input name="issueDate" type="date" /></label>}
            <label>Photo or file<input name="file" type="file" required accept={ACCEPT} capture="environment" /></label>
            <button className="btn">{i.sent ? 'Add another file' : 'Send'}</button>
          </form>
        </section>
      ))}

      {v.state === 'ok' && v.rightToWork && (
        <section className="card upload-item">
          <h2>Right to work <span className="badge bad">Needed</span></h2>
          {v.rightToWork.canSend ? (<>
            <p className="muted" style={{ marginTop: 0 }}>A photo of your passport, citizenship certificate or visa grant notice.{v.rightToWork.files ? ` Sent: ${v.rightToWork.files} ${v.rightToWork.files === 1 ? 'file' : 'files'}.` : ''}</p>
            <form action={send} className="form-row">
              <input type="hidden" name="kind" value="rtw" />
              <input type="hidden" name="label" value="your right to work proof" />
              <label>Photo or file<input name="file" type="file" required accept={ACCEPT} capture="environment" /></label>
              <button className="btn">{v.rightToWork.files ? 'Add another file' : 'Send'}</button>
            </form>
          </>) : <p className="muted" style={{ margin: 0 }}>Please contact {v.business} about this: they will record your details with you first.</p>}
        </section>
      )}

      {v.state === 'ok' && !v.items.length && !v.rightToWork && (
        <section className="card"><p style={{ margin: 0 }}>There's nothing more to send right now. Thank you.</p></section>
      )}
      <p className="muted small" style={{ textAlign: 'center' }}>PDF, JPEG, PNG or HEIC, up to 10 MB each. Files are stored privately in Australia. Please don&apos;t send health details other than what&apos;s asked for.</p>
      <LegalFooter />
    </main>
  );
}
