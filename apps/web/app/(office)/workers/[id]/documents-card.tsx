import { DocLink } from '../../../../lib/doc-link';
import { DOCUMENT_KIND_CHOICES, documentMeta, documentsIntro, type WorkerDocument } from '../../../../lib/worker-documents';
import { removeWorkerDocument, uploadWorkerDocument } from '../actions';

/** The Documents tab: a CV, contracts and other documents the office keeps on the person's record. Office only. */
export function DocumentsCard({ workerId, first, docs, when }: { workerId: string; first: string; docs: WorkerDocument[]; when: (iso: string) => string }) {
  return (
    <div className="card">
      <h2>Documents</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{documentsIntro(docs.length, first)}</p>
      {docs.length > 0 && (
        <ul className="plain" style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
          {docs.map(d => (
            <li key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <strong style={{ minWidth: 120 }}>{d.label}</strong>
              <DocLink href={`/workers/${workerId}/files/${d.id}`} filename={d.filename} contentType={d.contentType} />
              <span className="muted small">{documentMeta(d, when)}</span>
              <form action={removeWorkerDocument.bind(null, workerId, d.id)} style={{ marginLeft: 'auto' }}>
                <button type="submit" className="btn small secondary" aria-label={`Remove ${d.filename}`}>Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={uploadWorkerDocument.bind(null, workerId)} className="form-row" style={{ alignItems: 'flex-end' }}>
        <label>Kind
          <select name="kind" defaultValue="cv">
            {DOCUMENT_KIND_CHOICES.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label>Name <span className="muted">(needed for Other)</span>
          <input name="title" maxLength={120} placeholder="e.g. Signed contract 2026" />
        </label>
        <label>File
          <input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/heic" style={{ fontSize: 13, padding: 4 }} />
        </label>
        <button type="submit" className="btn small">Keep on their record</button>
      </form>
      <p className="muted small" style={{ marginBottom: 0 }}>PDF, JPEG, PNG or HEIC, up to 10 MB. Removing a document takes it off the record; the audit log keeps who did it.</p>
    </div>
  );
}
