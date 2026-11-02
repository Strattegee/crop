import { RANK_CHOICES } from '../../../lib/client-orders';

/**
 * Client set-up for allocation (David, 2 Nov; migration 0069): whether the client confirms each booking before the
 * shift counts as filled, and their rank (1 = most loyal … 7 = fill-in), which orders the allocation screen.
 */
export function ClientAllocationFields({ client, shift, confirmsBookings = false, rank = null }: { client: string; shift: string; confirmsBookings?: boolean; rank?: number | null }) {
  return (<>
    <label style={{ flex: '0 1 220px' }}>{client.charAt(0).toUpperCase() + client.slice(1)} rank
      <select name="rank" defaultValue={rank ? String(rank) : ''}>
        {RANK_CHOICES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </label>
    <label className="inline" style={{ flex: '1 1 100%' }}>
      <input type="checkbox" name="confirmsBookings" defaultChecked={confirmsBookings} />
      {client.charAt(0).toUpperCase() + client.slice(1)} confirms each booking before the {shift} is filled
    </label>
  </>);
}
