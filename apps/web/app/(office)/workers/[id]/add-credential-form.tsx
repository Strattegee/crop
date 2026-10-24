'use client';

import { useState } from 'react';

type CredentialType = { id: string; name: string; hasNumber: boolean; hasExpiry: boolean };

/** Shows only the fields the chosen credential type uses, and marks the required ones. */
export function AddCredentialForm({ types, action }: { types: CredentialType[]; action: (f: FormData) => void | Promise<void> }) {
  const [typeId, setTypeId] = useState('');
  const type = types.find(t => t.id === typeId);
  return (
    <form action={action} className="form-row">
      <label>Credential
        <select name="credentialTypeId" required value={typeId} onChange={e => setTypeId(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {(!type || type.hasNumber) && (
        <label>Number{type && <span className="muted"> (required)</span>}<input name="number" maxLength={100} required={!!type?.hasNumber} /></label>
      )}
      <label>Issued <span className="muted">(optional)</span><input name="issueDate" type="date" /></label>
      {(!type || type.hasExpiry) && (
        <label>Expires{type && <span className="muted"> (required)</span>}<input name="expiryDate" type="date" required={!!type?.hasExpiry} /></label>
      )}
      <button type="submit" className="btn">Add</button>
    </form>
  );
}
