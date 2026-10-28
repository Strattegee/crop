type EditableCredential = {
  number: string | null; issuedBy?: string | null; issueDate: string | null; expiryDate: string | null; notes?: string | null; verification: string;
};

/**
 * Corrects a credential already recorded. The fields the credential type needs stay required.
 * Changing the number, issuer or dates of a checked credential sends it back for checking (the API does this).
 */
export function EditCredentialForm({ c, hasNumber, hasExpiry, action }: {
  c: EditableCredential; hasNumber: boolean; hasExpiry: boolean; action: (f: FormData) => void | Promise<void>;
}) {
  return (
    <details className="edit-credential">
      <summary style={{ cursor: 'pointer', fontSize: 13 }}>Edit</summary>
      <form action={action} style={{ display: 'grid', gap: 6, marginTop: 6, minWidth: 220 }}>
        <input type="hidden" name="verificationBefore" value={c.verification} />
        {(hasNumber || c.number) && (
          <label>Number{hasNumber && <span className="muted"> (required)</span>}
            <input name="number" maxLength={100} required={hasNumber} defaultValue={c.number ?? ''} />
          </label>
        )}
        <label>Issued by <span className="muted">(optional)</span>
          <input name="issuedBy" maxLength={120} defaultValue={c.issuedBy ?? ''} />
        </label>
        <label>Issued <span className="muted">(optional)</span>
          <input name="issueDate" type="date" defaultValue={c.issueDate ?? ''} />
        </label>
        {(hasExpiry || c.expiryDate) && (
          <label>Expires{hasExpiry && <span className="muted"> (required)</span>}
            <input name="expiryDate" type="date" required={hasExpiry} defaultValue={c.expiryDate ?? ''} />
          </label>
        )}
        <label>Notes <span className="muted">(optional)</span>
          <textarea name="notes" maxLength={2000} rows={2} defaultValue={c.notes ?? ''} />
        </label>
        {c.verification !== 'unverified' && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Changing the number, issuer or dates means it needs checking again before it counts.</p>
        )}
        <div><button type="submit" className="btn small">Save</button></div>
      </form>
    </details>
  );
}
