import { earlierRows, earlierValue, earlierWhen, type EarlierDetails } from '../../../../lib/earlier-details';

/**
 * Earlier values of the person's name, preferred name, email, mobile, gender and date of birth (David, answer 5:
 * nothing is overwritten). Read from the audit log; shown folded under the Details form.
 */
export function EarlierDetailsCard({ h, country, when }: { h: EarlierDetails | null; country: string | null | undefined; when: (iso: string) => string }) {
  const rows = earlierRows(h);
  if (!h) return null;
  if (rows.length === 0) return <p className="muted small" style={{ marginBottom: 0 }}>No earlier values: these details haven’t been changed since they were first recorded.</p>;
  return (
    <details style={{ marginTop: 12 }}>
      <summary className="muted" style={{ cursor: 'pointer' }}>Earlier values ({rows.length})</summary>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Detail</th><th>Was</th><th>Changed</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td>{earlierValue(r.field, r.value, country)}</td>
            <td className="muted small">{earlierWhen(r, when)}</td>
          </tr>
        ))}</tbody>
      </table>
    </details>
  );
}
