'use client';

import Script from 'next/script';
import { useActionState, useEffect } from 'react';
import { PERIODS, regionsFor, WEEKDAYS, type ApplyView } from '../../../lib/apply';
import { industryGroups, needsHeadings } from '../../../lib/industry-groups';
import { sendApply, type ApplyState } from './actions';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/heic,image/heif';

declare global { interface Window { turnstile?: { reset: () => void } } }

/**
 * The application form. Plain fields; the API checks everything and says what to fix. `preview` (Settings) shows it
 * exactly as applicants will, with sending switched off.
 */
export function ApplyForm({ view, preview = false }: { view: ApplyView; preview?: boolean }) {
  const [state, action, pending] = useActionState<ApplyState, FormData>(sendApply.bind(null, view.slug, view.custom), { status: 'idle' });
  // A Turnstile token works once: get a fresh one after a refusal.
  useEffect(() => { if (state.status === 'error') window.turnstile?.reset(); }, [state]);
  if (state.status === 'sent') {
    return (
      <div className="notice success" role="status">
        <p style={{ margin: 0 }}><strong>Nearly done: check your email.</strong></p>
        <p style={{ margin: '6px 0 0' }}>We’ve sent you a link to confirm your application. {view.business} sees it once you’ve opened that link (within 48 hours). If it hasn’t arrived in a few minutes, check your junk folder.</p>
      </div>
    );
  }
  const v = state.values ?? {};
  const one = (k: string) => v[k]?.[0];
  const has = (k: string, x: string) => !!v[k]?.includes(x);
  const asked = new Map(view.questions.map(q => [q.key, q.required]));
  const req = (k: Parameters<typeof asked.get>[0]) => asked.get(k) === true;
  const opt = (k: Parameters<typeof asked.get>[0]) => (asked.get(k) ? '' : ' (optional)');
  const roleGroups = industryGroups(view.roles, view.packs);
  const credGroups = industryGroups(view.credentials, view.packs);
  const regions = regionsFor(view.country);
  const yesNo = (name: string, label: string, required: boolean) => (
    <div className="form-row" role="radiogroup" aria-label={label}>
      <span style={{ flex: '1 1 100%' }}>{label}{required ? '' : ' (optional)'}</span>
      <label className="inline"><input type="radio" name={name} value="yes" required={required} defaultChecked={one(name) === 'yes'} /> Yes</label>
      <label className="inline"><input type="radio" name={name} value="no" defaultChecked={one(name) === 'no'} /> No</label>
    </div>
  );

  return (
    <form action={action} className="request-form apply-form">
      {state.status === 'error' && <p className="notice error" role="alert">{state.message}{Object.keys(v).length ? ' (Any files need choosing again.)' : ''}</p>}
      <input type="hidden" name="formToken" value={view.formToken ?? ''} />
      <fieldset>
        <legend>About you</legend>
        <div className="form-row">
          <label>First name<input name="firstName" required maxLength={100} defaultValue={one('firstName')} autoComplete="given-name" /></label>
          <label>Last name<input name="lastName" required maxLength={100} defaultValue={one('lastName')} autoComplete="family-name" /></label>
        </div>
        <div className="form-row">
          <label>Email<input name="email" type="email" required maxLength={254} defaultValue={one('email')} autoComplete="email" /></label>
          {asked.has('mobile') && <label>Mobile{opt('mobile')}<input name="mobile" type="tel" required={req('mobile')} maxLength={30} defaultValue={one('mobile')} autoComplete="tel" /></label>}
        </div>
        {asked.has('home') && (
          <div className="form-row">
            <label>{view.choices.home.suburb}{opt('home')}<input name="suburb" required={req('home')} maxLength={100} defaultValue={one('suburb')} autoComplete="address-level2" /></label>
            <label>{view.choices.home.region} (optional)
              {regions
                ? <select name="region" defaultValue={one('region') ?? ''}><option value="">Choose</option>{regions.map(s => <option key={s}>{s}</option>)}</select>
                : <input name="region" maxLength={60} defaultValue={one('region')} autoComplete="address-level1" />}
            </label>
            <label>{view.choices.home.postcode}{opt('home')}<input name="postcode" required={req('home') && view.country !== 'GB'} maxLength={10} defaultValue={one('postcode')} autoComplete="postal-code" /></label>
          </div>
        )}
        {asked.has('home') && <p className="muted small" style={{ margin: 0 }}>Just your suburb and postcode, so we can offer work near you. No street address.</p>}
      </fieldset>

      {(asked.has('roles') || asked.has('work_type') || asked.has('availability')) && (
        <fieldset>
          <legend>The work you’re after</legend>
          {asked.has('roles') && (
            <div>
              <p style={{ margin: '0 0 6px' }}>{view.word.roles[0].toUpperCase() + view.word.roles.slice(1)} you’re applying for{opt('roles')}</p>
              {roleGroups.map(g => (
                <div key={g.key} className="apply-ticks">
                  {needsHeadings(roleGroups) && <p className="muted small" style={{ margin: '4px 0' }}>{g.label}</p>}
                  {g.items.map(r => <label key={r.name} className="inline"><input type="checkbox" name="roles" value={r.name} defaultChecked={has('roles', r.name)} /> {r.name}</label>)}
                </div>
              ))}
            </div>
          )}
          {asked.has('work_type') && (
            <div className="apply-ticks">
              <p style={{ margin: '0 0 6px', flex: '1 1 100%' }}>Kind of work{opt('work_type')}</p>
              {view.choices.workTypes.map(w => <label key={w.value} className="inline"><input type="checkbox" name="workTypes" value={w.value} defaultChecked={has('workTypes', w.value)} /> {w.label}</label>)}
            </div>
          )}
          {asked.has('availability') && (
            <div>
              <p style={{ margin: '0 0 6px' }}>When you can usually work{opt('availability')}</p>
              <div style={{ overflowX: 'auto' }}>
                <table className="apply-week">
                  <thead><tr><th scope="col"><span className="sr-only">Day</span></th>{PERIODS.map(p => <th key={p.value} scope="col">{p.label}</th>)}</tr></thead>
                  <tbody>
                    {WEEKDAYS.map(d => (
                      <tr key={d.n}>
                        <th scope="row">{d.label}</th>
                        {PERIODS.map(p => (
                          <td key={p.value}><input type="checkbox" name={`avail_${d.n}`} value={p.value} aria-label={`${d.label} ${p.label.toLowerCase()}`} defaultChecked={has(`avail_${d.n}`, p.value)} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </fieldset>
      )}

      {(asked.has('right_to_work') || asked.has('licence_car')) && (
        <fieldset>
          <legend>Right to work and getting around</legend>
          {asked.has('right_to_work') && (<>
            {yesNo('rightToWork', `Do you have the right to work here?`, req('right_to_work'))}
            <label>If yes, your status
              <select name="rightToWorkStatus" defaultValue={one('rightToWorkStatus') ?? ''}>
                <option value="">Choose</option>
                {view.choices.rightToWork.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <p className="muted small" style={{ margin: 0 }}>No document numbers or visa details here: {view.business} will check your right to work with you later.</p>
          </>)}
          {asked.has('licence_car') && (<>
            {yesNo('driversLicence', 'Do you have a driver’s licence?', req('licence_car'))}
            {yesNo('ownCar', 'Do you have your own car?', req('licence_car'))}
          </>)}
        </fieldset>
      )}

      {asked.has('credentials') && view.credentials.length > 0 && (
        <fieldset>
          <legend>Qualifications and tickets (optional)</legend>
          <p className="muted small" style={{ margin: 0 }}>Tick what you hold. A photo or file of each helps (PDF, JPEG, PNG or HEIC, up to 10 MB).</p>
          {credGroups.map(g => (
            <div key={g.key}>
              {needsHeadings(credGroups) && <p className="muted small" style={{ margin: '4px 0' }}>{g.label}</p>}
              {g.items.map(c => (
                <div key={c.id} className="apply-cred">
                  <label className="inline"><input type="checkbox" name="credentials" value={c.id} defaultChecked={has('credentials', c.id)} /> {c.name}</label>
                  <label className="small">Photo or file<input type="file" name={`cred_${c.id}`} accept={ACCEPT} /></label>
                </div>
              ))}
            </div>
          ))}
        </fieldset>
      )}

      {(asked.has('about') || asked.has('cv') || asked.has('heard') || view.custom.length > 0) && (
        <fieldset>
          <legend>A bit more</legend>
          {asked.has('about') && (
            <label>About you{opt('about')}
              <textarea name="about" rows={4} maxLength={2000} required={req('about')} defaultValue={one('about')} placeholder="Your experience, what you’re looking for" />
            </label>
          )}
          {asked.has('cv') && <label>CV or résumé{opt('cv')}<input type="file" name="cv" accept={ACCEPT} required={req('cv')} /></label>}
          {view.custom.map(q => (
            <div key={q.id}>
              {q.type === 'short_text' && <label>{q.label}{q.required ? '' : ' (optional)'}<input name={`c_${q.id}`} maxLength={200} required={q.required} defaultValue={one(`c_${q.id}`)} /></label>}
              {q.type === 'long_text' && <label>{q.label}{q.required ? '' : ' (optional)'}<textarea name={`c_${q.id}`} rows={3} maxLength={2000} required={q.required} defaultValue={one(`c_${q.id}`)} /></label>}
              {q.type === 'yes_no' && yesNo(`c_${q.id}`, q.label, q.required)}
              {q.type === 'choice' && (
                <label>{q.label}{q.required ? '' : ' (optional)'}
                  <select name={`c_${q.id}`} required={q.required} defaultValue={one(`c_${q.id}`) ?? ''}>
                    <option value="">Choose</option>
                    {q.choices.map(c => <option key={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {q.type === 'multi_choice' && (
                <div className="apply-ticks">
                  <p style={{ margin: '0 0 6px', flex: '1 1 100%' }}>{q.label}{q.required ? '' : ' (optional)'}</p>
                  {q.choices.map(c => <label key={c} className="inline"><input type="checkbox" name={`c_${q.id}`} value={c} defaultChecked={has(`c_${q.id}`, c)} /> {c}</label>)}
                </div>
              )}
              {q.type === 'file' && <label>{q.label}{q.required ? '' : ' (optional)'}<input type="file" name={`q_${q.id}`} accept={ACCEPT} required={q.required} /></label>}
              {q.help && <p className="muted small" style={{ margin: '2px 0 0' }}>{q.help}</p>}
            </div>
          ))}
          {asked.has('heard') && (<>
            <label>How did you hear about us?{opt('heard')}
              <select name="heardFrom" required={req('heard')} defaultValue={one('heardFrom') ?? ''}>
                <option value="">Choose</option>
                {view.choices.heard.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label>If somewhere else, where? (optional)<input name="heardOther" maxLength={200} defaultValue={one('heardOther')} /></label>
          </>)}
          <p className="muted small" style={{ margin: 0 }}>Please don’t include health details or document numbers.</p>
        </fieldset>
      )}

      <fieldset>
        <legend>Your privacy</legend>
        <label className="inline" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" name="consent" value="yes" required defaultChecked={one('consent') === 'yes'} />
          <span>
            I agree to {view.business} and CROP handling my application as set out in the{' '}
            <a href="/legal/privacy" target="_blank" rel="noreferrer">privacy policy</a> and the{' '}
            <a href="/legal/worker-notice" target="_blank" rel="noreferrer">worker privacy notice</a>.
          </span>
        </label>
      </fieldset>

      {/* Left empty by people; robots fill it in. */}
      <div aria-hidden="true" className="hp"><label>Website<input name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label></div>
      {view.turnstileSiteKey && !preview && (<>
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
        <div className="cf-turnstile" data-sitekey={view.turnstileSiteKey} />
      </>)}
      {preview
        ? <p className="notice">Preview: this is how applicants see the form. Nothing can be sent from here.</p>
        : <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send application'}</button>}
      <p className="muted small">Files are stored privately in Australia. Up to {view.maxFiles} files, 10 MB each and 30 MB in all.</p>
    </form>
  );
}
