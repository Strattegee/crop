'use client';

import { useState } from 'react';
import { PROOF_LABEL, RTW_STATUS, VEVO_URL } from '../../../../lib/right-to-work';

type Current = {
  status: string; citizenProofType: string | null; documentNumber: string | null; visaType: string | null; visaSubclass: string | null;
  visaGrantNumber: string | null; visaExpiry: string | null; workLimit: string | null; workHoursPerFortnight: number | null;
  vevoCheckedOn: string | null; vevoResult: string | null;
} | null;

/** Asks only for what applies to the chosen status. */
export function RightToWorkForm({ action, current }: { action: (f: FormData) => void; current: Current }) {
  const [status, setStatus] = useState(current?.status ?? '');
  const [limit, setLimit] = useState(current?.workLimit ?? '');
  const needsVevo = status !== '' && status !== 'citizen';

  return (
    <form action={action} className="form-row">
      <label>Work rights status
        <select name="status" required value={status} onChange={e => setStatus(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {Object.entries(RTW_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      {status === 'citizen' && (
        <>
          <label>Proof of citizenship
            <select name="citizenProofType" required defaultValue={current?.citizenProofType ?? ''}>
              <option value="" disabled>Choose…</option>
              {Object.entries(PROOF_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Document number<input name="documentNumber" maxLength={60} defaultValue={current?.documentNumber ?? ''} /></label>
        </>
      )}

      {status === 'nz_citizen' && (
        <label>NZ passport number<input name="documentNumber" maxLength={60} defaultValue={current?.documentNumber ?? ''} /></label>
      )}

      {status === 'permanent_resident' && (
        <label>Visa grant number<input name="visaGrantNumber" maxLength={60} defaultValue={current?.visaGrantNumber ?? ''} /></label>
      )}

      {status === 'visa_holder' && (
        <>
          <label>Visa type<input name="visaType" required maxLength={80} placeholder="e.g. Student" defaultValue={current?.visaType ?? ''} /></label>
          <label>Subclass<input name="visaSubclass" required maxLength={3} inputMode="numeric" pattern="[0-9]{3}" placeholder="e.g. 500" defaultValue={current?.visaSubclass ?? ''} /></label>
          <label>Grant number<input name="visaGrantNumber" maxLength={60} defaultValue={current?.visaGrantNumber ?? ''} /></label>
          <label>Visa expiry<input name="visaExpiry" type="date" required defaultValue={current?.visaExpiry ?? ''} /></label>
          <label>Work conditions
            <select name="workLimit" required value={limit} onChange={e => setLimit(e.target.value)}>
              <option value="" disabled>Choose…</option>
              <option value="unlimited">No work limit</option>
              <option value="limited">Limited hours</option>
            </select>
          </label>
          {limit === 'limited' && (
            <label>Hours per fortnight<input name="workHoursPerFortnight" type="number" min={1} max={336} required defaultValue={current?.workHoursPerFortnight ?? 48} /></label>
          )}
        </>
      )}

      {needsVevo && (
        <>
          <label>VEVO checked on<input name="vevoCheckedOn" type="date" required defaultValue={current?.vevoCheckedOn ?? ''} /></label>
          <label>VEVO result
            <select name="vevoResult" required defaultValue={current?.vevoResult ?? ''}>
              <option value="" disabled>Choose…</option>
              <option value="confirmed">Work rights confirmed</option>
              <option value="not_confirmed">Not confirmed</option>
            </select>
          </label>
        </>
      )}

      {status && <button type="submit" className="btn">Save</button>}
      {needsVevo && (
        <p className="muted" style={{ flexBasis: '100%', margin: 0, fontSize: 13 }}>
          Check work rights in <a href={VEVO_URL} target="_blank" rel="noreferrer">VEVO</a> and upload the result below.
        </p>
      )}
    </form>
  );
}
