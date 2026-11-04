'use client';

import { useActionState } from 'react';
import { placeLabels } from '../../../lib/customer-request';
import { sendCustomerRequest, type SendState } from './actions';

const AU_STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

/** The request form. Plain fields; the API checks everything and says what to fix. */
export function RequestForm({ slug, country, today, business }: { slug: string; country: string; today: string; business: string }) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendCustomerRequest.bind(null, slug), { status: 'idle' });
  if (state.status === 'sent') {
    return (
      <div className="notice success" role="status">
        <p style={{ margin: 0 }}><strong>Thanks, your request has been sent.</strong></p>
        <p style={{ margin: '6px 0 0' }}>{business} will contact you to confirm the details. If it’s urgent, please call them.</p>
      </div>
    );
  }
  const v = state.values ?? {};
  const labels = placeLabels(country);
  return (
    <form action={action} className="request-form">
      {state.status === 'error' && <p className="notice error" role="alert">{state.message}</p>}
      <fieldset>
        <legend>About you</legend>
        <label>Business or organisation<input name="businessName" required maxLength={200} defaultValue={v.businessName} autoComplete="organization" /></label>
        <label>Your name<input name="contactName" required maxLength={200} defaultValue={v.contactName} autoComplete="name" /></label>
        <div className="form-row">
          <label>Your email<input name="email" type="email" required maxLength={254} defaultValue={v.email} autoComplete="email" /></label>
          <label>Your phone<input name="phone" type="tel" maxLength={30} defaultValue={v.phone} autoComplete="tel" /></label>
        </div>
        <div className="form-row">
          <label className="inline"><input type="radio" name="frequency" value="once" defaultChecked={(v.frequency ?? 'once') === 'once'} /> Just this once</label>
          <label className="inline"><input type="radio" name="frequency" value="repeat" defaultChecked={v.frequency === 'repeat'} /> We’ll need staff again</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Where</legend>
        <label>Site name (optional)<input name="siteName" maxLength={200} defaultValue={v.siteName} placeholder="e.g. Main kitchen" /></label>
        <label>Street address<input name="address" required maxLength={300} defaultValue={v.address} autoComplete="street-address" /></label>
        <div className="form-row">
          <label>{labels.suburb}<input name="suburb" maxLength={100} defaultValue={v.suburb} autoComplete="address-level2" /></label>
          <label>{labels.region}
            {country === 'AU'
              ? <select name="region" defaultValue={v.region ?? ''}><option value="">Choose</option>{AU_STATES.map(s => <option key={s}>{s}</option>)}</select>
              : <input name="region" maxLength={100} defaultValue={v.region} autoComplete="address-level1" />}
          </label>
          <label>{labels.postcode}<input name="postcode" maxLength={12} defaultValue={v.postcode} autoComplete="postal-code" /></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Who and when</legend>
        <label>Who you need<input name="role" required maxLength={100} defaultValue={v.role} placeholder="e.g. Registered nurse, barista, labourer" /></label>
        <div className="form-row">
          <label>Date<input name="date" type="date" required min={today} defaultValue={v.date} /></label>
          <label>Start<input name="startTime" type="time" required defaultValue={v.startTime} /></label>
          <label>Finish<input name="endTime" type="time" required defaultValue={v.endTime} /></label>
          <label>How many people<input name="people" type="number" min={1} max={20} required defaultValue={v.people ?? '1'} /></label>
        </div>
        <label>Anything else we should know (optional)
          <textarea name="notes" maxLength={1000} rows={3} defaultValue={v.notes} placeholder="Parking, how to get in, uniform, or more dates" />
        </label>
        <p className="muted small">Please don’t include health or personal details about anyone.</p>
      </fieldset>
      {/* Left empty by people; robots fill it in. */}
      <div aria-hidden="true" className="hp"><label>Website<input name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label></div>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send request'}</button>
    </form>
  );
}
