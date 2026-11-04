import { describe, expect, it } from 'vitest';
import { addressBody, doneMessage, fieldBody, fieldProblem, fieldValue, saveLabel, showMobile, startValue, waitingFor, type MyField } from '../src/details';

const mobile: MyField = { field: 'mobile', label: 'Mobile', value: '+61412345678', raw: '+61412345678', canChange: true, needsApproval: false };

describe('my details in the app (David, 3 Nov, answer 5)', () => {
  it('shows mobiles the business’s way, like the office', () => {
    expect(showMobile('+61412345678', 'AU')).toBe('0412 345 678');
    expect(showMobile('+64211234567', 'AU')).toBe('+64 21 123 4567');
    expect(showMobile('+12125550123', 'US')).toBe('(212) 555-0123');
    expect(showMobile('+447700900123', 'GB')).toBe('07700 900123');
    expect(showMobile('0412 345 678', 'AU')).toBe('0412 345 678');
    expect(fieldValue(mobile, 'AU')).toBe('0412 345 678');
    expect(fieldValue({ ...mobile, value: null }, 'AU')).toBe('Not given');
  });

  it('starts the form from what is stored and builds the change', () => {
    expect(startValue(mobile, 'AU').value).toBe('0412 345 678');
    expect(startValue({ ...mobile, field: 'name', raw: { firstName: 'Ana', lastName: 'Example' } }, 'AU')).toMatchObject({ firstName: 'Ana', lastName: 'Example' });
    expect(fieldBody('name', { firstName: ' Ana ', lastName: 'Sample' })).toEqual({ field: 'name', firstName: 'Ana', lastName: 'Sample' });
    expect(fieldBody('gender', { value: '' })).toEqual({ field: 'gender', value: '' });
    expect(fieldProblem('name', { firstName: 'Ana' })).toBe('Enter your first and last name');
    expect(fieldProblem('mobile', { value: '' })).toBeNull();
    expect(addressBody({ label: '', line1: '1 Sample Rd', line2: '', suburb: 'Carlton', state: 'VIC', postcode: '3053' }, 'a1'))
      .toMatchObject({ field: 'address', action: 'correct', addressId: 'a1', line1: '1 Sample Rd' });
    expect(addressBody({ label: '', line1: '1 Sample Rd', line2: '', suburb: '', state: '', postcode: '' })).toMatchObject({ action: 'add' });
  });

  it('says whether it goes to the office', () => {
    expect(saveLabel(true)).toBe('Send to the office');
    expect(doneMessage('requested').title).toBe('Sent to the office');
    expect(waitingFor([{ id: 'c', field: 'mobile', addressId: null, label: 'Mobile', what: '', line: '', status: 'pending', note: null, canWithdraw: true }], 'mobile')).toBe(true);
    expect(waitingFor([{ id: 'c', field: 'address', addressId: 'a1', label: 'Address', what: '', line: '', status: 'pending', note: null, canWithdraw: true }], 'address', 'a2')).toBe(false);
  });
});
