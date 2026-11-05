import Link from 'next/link';
import { api } from '../../../../lib/api';
import { applySummary, applyUrl, MODE_LABEL, type CustomQuestion } from '../../../../lib/apply';
import { authConfig } from '../../../../lib/config';
import { currentAgency } from '../../../../lib/current-user';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { addApplyQuestion, moveApplyQuestion, removeApplyQuestion, saveApplyBasics, saveApplyQuestion } from './actions';
import { CopyLink } from './copy-link';

export const dynamic = 'force-dynamic';

type Mode = 'off' | 'optional' | 'required';
type Settings = {
  open: boolean; intro: string | null; slug: string; turnstile: boolean; waiting: number; confirmed30: number;
  builtIn: { key: string; label: string; note: string; mode: Mode; allowed: Mode[] }[];
  custom: CustomQuestion[];
  customTypes: { value: string; label: string }[];
};

/**
 * Settings › Application form (function code 9200; David approved 5 Nov 2026): a public form where people apply to
 * work with the business. Closed until an owner or admin opens it. Applications reach the recruitment board (Applied)
 * once the applicant confirms their email.
 */
export default async function ApplicationFormPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [tw, agency, s, sp] = await Promise.all([words(), currentAgency(), api<Settings>('/apply-form'), searchParams]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const url = applyUrl(authConfig().appUrl, s.slug);
  const typeLabel = new Map(s.customTypes.map(t => [t.value, t.label]));
  const questionFields = (q?: CustomQuestion) => (<>
    <label>Question<input name="label" required maxLength={200} defaultValue={q?.label} placeholder="e.g. Can you work weekends?" /></label>
    <label>Note under it (optional)<input name="help" maxLength={300} defaultValue={q?.help ?? ''} /></label>
    <div className="form-row">
      <label>Answer
        <select name="type" defaultValue={q?.type ?? 'short_text'}>
          {s.customTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label className="inline"><input type="checkbox" name="required" defaultChecked={q?.required} /> Required</label>
    </div>
    <label>Choices, one per line (for Pick one and Pick any)<textarea name="choices" rows={3} defaultValue={q?.choices.join('\n')} /></label>
  </>);

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Application form</h1>
      <p className="muted">
        A page where people apply to work with you, without signing in. Each application waits until the applicant confirms their email,
        then they’re on the <Link href="/recruitment">recruitment board</Link> at Applied, with their answers on their page. Their
        {' '}{tw.lower(T.credential, true)} come in unchecked, and their right to work is only what they told you until you check it.
      </p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change the form.</div>}

      <section className="card">
        <h2>{s.open ? 'Open: taking applications' : 'Closed'}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>{applySummary(s.waiting, s.confirmed30)}</p>
        {s.open
          ? <p>Share this link on your website, job ads or social media:</p>
          : <p className="muted">When it’s open, this is where people apply (the page says it isn’t available until then):</p>}
        <CopyLink url={url} />
        <p className="small" style={{ marginBottom: 0 }}>
          <Link href="/settings/application-form/preview">Preview the form</Link>
          {s.open && <> · <a href={url} target="_blank" rel="noreferrer">Open the live page</a></>}
        </p>
        <p className="muted small">
          Spam protection: a hidden trap field, forms sent too quickly are refused, at most a few applications an hour from one connection,
          and every applicant confirms their email.{s.turnstile ? ' Cloudflare’s invisible check is on as well.' : ''}
        </p>
      </section>

      <form action={saveApplyBasics} className="card">
        <h2>Starter questions</h2>
        <label className="inline"><input type="checkbox" name="open" defaultChecked={s.open} disabled={!canEdit} /> Take applications (the form is open)</label>
        <label>Welcome line (optional)
          <textarea name="intro" rows={2} maxLength={800} defaultValue={s.intro ?? ''} disabled={!canEdit} placeholder="e.g. We’re hiring baristas and cooks for our Fitzroy café." />
        </label>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Question</th><th>On the form</th></tr></thead>
            <tbody>
              {s.builtIn.map(q => (
                <tr key={q.key}>
                  <td><strong>{q.label}</strong><div className="muted small">{q.note}</div></td>
                  <td>
                    {q.allowed.length === 1 || !canEdit ? (q.allowed.length === 1 ? 'Always asked' : MODE_LABEL[q.mode]) : (
                      <select name={`mode_${q.key}`} defaultValue={q.mode} aria-label={`${q.label}: on the form`}>
                        {q.allowed.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <button type="submit">Save</button>}
      </form>

      <section className="card">
        <h2>Your own questions</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Asked after the starter questions, in this order. Changing or removing one never changes answers already sent.</p>
        {s.custom.length === 0 && <p className="muted">None yet.</p>}
        {s.custom.map((q, i) => (
          <details key={q.id} className="apply-q">
            <summary>
              <strong>{q.label}</strong> <span className="muted small">· {typeLabel.get(q.type)}{q.required ? ' · required' : ''}{q.choices.length ? ` · ${q.choices.join(', ')}` : ''}</span>
            </summary>
            {canEdit && (
              <div style={{ marginTop: 8 }}>
                <form action={saveApplyQuestion}>
                  <input type="hidden" name="id" value={q.id} />
                  {questionFields(q)}
                  <button type="submit" className="btn small">Save</button>
                </form>
                <div className="form-row" style={{ marginTop: 8 }}>
                  {i > 0 && <form action={moveApplyQuestion}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="dir" value="up" /><button className="btn small secondary">Move up</button></form>}
                  {i < s.custom.length - 1 && <form action={moveApplyQuestion}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="dir" value="down" /><button className="btn small secondary">Move down</button></form>}
                  <form action={removeApplyQuestion}><input type="hidden" name="id" value={q.id} /><button className="btn small secondary">Take off the form</button></form>
                </div>
              </div>
            )}
          </details>
        ))}
        {canEdit && (
          <details className="apply-q" open={s.custom.length === 0}>
            <summary>+ Add a question</summary>
            <form action={addApplyQuestion} style={{ marginTop: 8 }}>
              {questionFields()}
              <button type="submit" className="btn small">Add question</button>
            </form>
          </details>
        )}
      </section>

      <div className="card">
        <h2>Before you share it</h2>
        <p className="small" style={{ margin: 0 }}>
          The form links to the <Link href="/legal/privacy">privacy policy</Link> and <Link href="/legal/worker-notice">worker privacy notice</Link>,
          and applicants agree to them. Check those pages are complete before taking real applications.
        </p>
      </div>
    </>
  );
}
