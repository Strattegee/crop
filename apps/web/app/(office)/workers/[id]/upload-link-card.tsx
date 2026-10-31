import { sendUploadLink, stopUploadLink } from './upload-link-actions';

export type UploadLinkInfo = {
  link: null | { sentAt: string; expiresAt: string; lastUsedAt: string | null; state: 'ok' | 'expired' | 'stopped' };
  needs: { credentialTypeId: string; typeName: string; required: boolean; waiting?: boolean }[];
  rightToWork: boolean;
};

/**
 * Ask for documents (approved by David 29 Oct): emails the person a one-off link for what's still needed. What they
 * send waits here for checking. A new link replaces the old one.
 */
export function UploadLinkCard({ workerId, info, first, hasEmail, hasPhone, when, word }: {
  workerId: string; info: UploadLinkInfo; first: string; hasEmail: boolean; hasPhone: boolean; when: (iso: string) => string; word: string;
}) {
  const asking = [...info.needs.filter(n => !n.waiting).map(n => n.typeName), ...(info.rightToWork ? ['right to work proof'] : [])];
  const toCheck = info.needs.filter(n => n.waiting).map(n => n.typeName);
  const l = info.link;
  return (
    <div className="card">
      <h2>Ask for documents</h2>
      {asking.length === 0
        ? <p className="muted" style={{ margin: 0 }}>Nothing is needed from {first} right now.</p>
        : <p style={{ marginTop: 0 }}>Still needed from {first}: {asking.join(', ')}.</p>}
      {toCheck.length > 0 && <p className="small" style={{ marginTop: 0 }}>Sent and waiting for you to check: {toCheck.join(', ')}.</p>}
      {l && (
        <p className="muted small">
          Last link sent {when(l.sentAt)}{' · '}
          {l.state === 'ok' ? `works until ${when(l.expiresAt)}` : l.state === 'expired' ? 'run out' : 'stopped'}
          {l.lastUsedAt ? ` · last used ${when(l.lastUsedAt)}` : ' · not used yet'}
        </p>
      )}
      {asking.length > 0 && (hasEmail || hasPhone) && (
        <form action={sendUploadLink.bind(null, workerId)} className="form-row">
          <label style={{ flex: '2 1 260px' }}>Note <span className="muted">(optional, added to the message)</span><input name="note" maxLength={500} /></label>
          {hasPhone && <label className="inline"><input type="checkbox" name="sms" />Text it too</label>}
          <button className="btn small">{l?.state === 'ok' ? 'Send a new link' : 'Send upload link'}</button>
        </form>
      )}
      {asking.length > 0 && !hasEmail && !hasPhone && <p className="muted small">Add their email or mobile under Details to send them a link.</p>}
      {l?.state === 'ok' && (
        <form action={stopUploadLink.bind(null, workerId)} style={{ marginTop: 8 }}>
          <button className="btn small secondary">Stop the link</button>
        </form>
      )}
      <p className="muted small" style={{ marginBottom: 0 }}>The link works for 7 days, only for what's still needed. Each {word} they send waits here to be checked; nothing counts until it is.</p>
    </div>
  );
}
