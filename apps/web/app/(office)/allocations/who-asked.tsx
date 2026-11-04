'use client';

import { useEffect, useRef, useState } from 'react';
import { CHANNELS, contactLine, contactsFor, type ClientContact } from '../../../lib/client-orders';

/**
 * The new order's "Who asked" part (client contacts, migration 0072): once a client and site is chosen, the client's
 * saved contacts can be picked instead of typing; anything typed beside a picked contact wins (e.g. a different phone).
 * Typed details can be saved as a new contact of the client. Reads the form's `place` choice, so it lives in that form.
 */
export function WhoAsked({ contacts, client }: { contacts: ClientContact[]; client: string }) {
  const ref = useRef<HTMLFieldSetElement>(null);
  const [place, setPlace] = useState('');
  const [contactId, setContactId] = useState('');
  useEffect(() => {
    const select = ref.current?.closest('form')?.querySelector<HTMLSelectElement>('select[name="place"]');
    if (!select) return;
    const read = () => setPlace(select.value);
    read();
    select.addEventListener('change', read);
    return () => select.removeEventListener('change', read);
  }, []);
  const choices = contactsFor(contacts, place);
  const picked = choices.find(c => c.id === contactId) ?? null;
  useEffect(() => {
    if (contactId && !picked) setContactId('');
  }, [contactId, picked]);

  return (
    <fieldset className="weekdays client-order-who" ref={ref}>
      <legend>Who asked</legend>
      {choices.length > 0 && (
        <label style={{ flex: '1 1 100%' }}>Saved contact
          <select name="contactId" value={contactId} onChange={e => setContactId(e.target.value)}>
            <option value="">Someone else (type their details)</option>
            {choices.map(c => <option key={c.id} value={c.id}>{contactLine(c)}</option>)}
          </select>
        </label>
      )}
      <label>Name{picked && <span className="muted"> (from the contact)</span>}
        <input name="requestedByName" required={!picked} maxLength={120} placeholder={picked?.name ?? ''} key={`n${picked?.id ?? ''}`} />
      </label>
      <label>Email <span className="muted">(for the booked email)</span>
        <input name="requestedByEmail" type="email" maxLength={200} placeholder={picked?.email ?? ''} key={`e${picked?.id ?? ''}`} />
      </label>
      <label>Phone <span className="muted">(optional)</span>
        <input name="requestedByPhone" maxLength={40} placeholder={picked?.phone ?? ''} key={`p${picked?.id ?? ''}`} />
      </label>
      <label style={{ flex: '0 1 130px' }}>How
        <select name="channel" defaultValue="email">{CHANNELS.filter(c => c.value !== 'request_page').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
      </label>
      <label style={{ flex: '0 1 160px' }}>Their reference <span className="muted">(optional)</span><input name="clientReference" maxLength={60} /></label>
      <label style={{ flex: '2 1 280px' }}>Order notes <span className="muted">(optional, for the office)</span><input name="orderNotes" maxLength={1000} /></label>
      {!picked && place && (
        <label className="inline" style={{ flex: '1 1 100%' }}>
          <input type="checkbox" name="saveContact" />Save them as a contact for this {client}, to pick next time
        </label>
      )}
    </fieldset>
  );
}
