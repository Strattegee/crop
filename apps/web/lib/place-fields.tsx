import { COUNTRIES, STATES, US_STATES, zoneName, type CountryCode } from './places';

/**
 * Country, town, state or region, postcode and time zone for a site (migration 0028). Plain form fields, no
 * browser code: Australian and US states come as suggestions, the API checks them against the country, and
 * a blank time zone is worked out from the state (or the country's main time zone).
 */
export function PlaceFields({ d = {}, homeCountry = 'AU', editing = false }: {
  d?: { country?: string | null; suburb?: string | null; state?: string | null; postcode?: string | null; timezone?: string | null };
  homeCountry?: string; editing?: boolean;
}) {
  const country = (d.country ?? homeCountry) as CountryCode;
  return (
    <>
      <label>Country
        <select name="country" defaultValue={country}>
          {Object.entries(COUNTRIES).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
        </select>
      </label>
      <label>Suburb or town<input name="suburb" defaultValue={d.suburb ?? ''} maxLength={100} /></label>
      <label>State or region
        <input name="state" defaultValue={d.state ?? (editing ? '' : country === 'AU' ? 'VIC' : '')} maxLength={60} list="regions" placeholder="e.g. VIC, CA, Auckland" />
        <datalist id="regions">{[...STATES, ...US_STATES].map(s => <option key={s} value={s} />)}</datalist>
      </label>
      <label>Postcode<input name="postcode" defaultValue={d.postcode ?? ''} maxLength={10} /></label>
      <label>Time zone
        <select name="timezone" defaultValue={editing ? d.timezone ?? '' : ''}>
          <option value="">Work it out from the state</option>
          {Object.entries(COUNTRIES).map(([k, c]) => (
            <optgroup key={k} label={c.name}>{c.zones.map(z => <option key={z} value={z}>{zoneName(z)}</option>)}</optgroup>
          ))}
        </select>
      </label>
    </>
  );
}
