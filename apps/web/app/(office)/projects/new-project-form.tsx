import { PlaceFields } from '../../../lib/place-fields';
import { T, words } from '../../../lib/terms';
import { OfficeField } from '../settings/offices/office-field';
import { addProject } from './actions';

type Choice = { id: string; name: string; status?: string };
type Person = { userId: string; name: string };

/**
 * The new-project form (David, 5 Nov: projects sit under clients). Used on the Projects list, a client's page (the
 * client chosen already) and the roster (`compact`: the essentials, then back to the roster with the project on its
 * own). Posts to `addProject`, which reads `from` to know where to go next.
 */
export async function NewProjectForm({ clients, people = [], offices = [], country = 'AU', timezone, clientId, from, week, compact = false }: {
  clients: Choice[]; people?: Person[]; offices?: { id: string; name: string; active: boolean }[]; country?: string; timezone?: string;
  clientId?: string; from: 'projects' | 'client' | 'roster'; week?: string; compact?: boolean;
}) {
  const tw = await words();
  const client = tw.one(T.client);
  const preset = clientId ? clients.find(c => c.id === clientId) : undefined;
  return (
    <form action={addProject} className="form-row" style={{ marginTop: 12 }}>
      <input type="hidden" name="from" value={from} />
      {week && <input type="hidden" name="week" value={week} />}
      <label>Name<input name="name" required maxLength={200} placeholder="e.g. Beach Hut" autoFocus={compact} /></label>
      <label>Code or reference<input name="code" maxLength={30} placeholder="e.g. P-2041" /></label>
      {preset && from === 'client' ? (
        <input type="hidden" name="clientId" value={preset.id} />
      ) : (
        <label>{client}{compact ? '' : ' (optional)'}
          <select name="clientId" defaultValue={preset?.id ?? ''}>
            <option value="">None: our own work</option>
            {clients.filter(c => c.status !== 'inactive' || c.id === clientId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {!compact && (
        <label>Manager
          <select name="managerUserId" defaultValue="">
            <option value="">Not chosen yet</option>
            {people.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </select>
        </label>
      )}
      <label>Starts<input type="date" name="startsOn" /></label>
      <label>Expected completion<input type="date" name="endsOn" /></label>
      {compact ? (
        // The business's own time zone until the address is added on the project's page.
        <>
          <input type="hidden" name="country" value={country} />
          {timezone && <input type="hidden" name="timezone" value={timezone} />}
        </>
      ) : (
        <>
          <label style={{ flexBasis: '100%' }}>Street address<input name="addressLine" maxLength={200} /></label>
          <PlaceFields homeCountry={country} />
          <OfficeField offices={offices} />
        </>
      )}
      <label style={{ flexBasis: '100%' }}>{tw.many(T.area)} (optional), one per line or separated by commas
        <textarea name="areas" rows={compact ? 2 : 3} maxLength={3000} placeholder={'e.g. Ground floor\nLevel 1\nCar park'} />
      </label>
      {!compact && <label style={{ flexBasis: '100%' }}>Description (optional)<textarea name="description" rows={2} maxLength={2000} /></label>}
      <button type="submit" className="btn">Add {tw.lower(T.project)}</button>
    </form>
  );
}
