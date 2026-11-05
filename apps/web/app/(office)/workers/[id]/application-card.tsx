import { Fragment } from 'react';
import type { JobApplication } from '../../../../lib/apply';

/**
 * "Applied online" on the person's Overview (applying online, 5 Nov): what they sent, as they sent it. Their right to
 * work is only what they said, and qualifications they ticked arrive unchecked on the Credentials tab.
 */
export function ApplicationCard({ workerId, apps, when }: { workerId: string; apps: JobApplication[]; when: (iso: string) => string }) {
  if (!apps.length) return null;
  return (
    <div className="card">
      <h2>Applied online</h2>
      {apps.map((a, i) => (
        <div key={a.id} style={i ? { borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 } : undefined}>
          <p className="muted small" style={{ marginTop: 0 }}>
            Sent {when(a.createdAt)}, email confirmed {when(a.confirmedAt)}{a.outcome === 'existing_person' ? ' · they were already on file, so nothing on their record was changed' : ''}.
            {' '}Agreed to the privacy policy and worker notice ({a.consentVersion}).
          </p>
          <dl className="apply-answers">
            {a.answers.map((x, j) => <Fragment key={j}><dt>{x.label}</dt><dd>{x.value}</dd></Fragment>)}
            {a.files.length > 0 && (<>
              <dt>Files</dt>
              <dd>{a.files.map((f, j) => (
                <span key={f.id}>{j ? ' · ' : ''}{f.label}: <a href={`/workers/${workerId}/application-files/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a></span>
              ))}</dd>
            </>)}
          </dl>
        </div>
      ))}
    </div>
  );
}
