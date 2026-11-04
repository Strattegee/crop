import { describe, expect, it } from 'vitest';
import { placeLabels, REQUEST_FIELDS, requestPageUrl, requestStatus } from '../lib/customer-request';
import { hasCustomers } from '../lib/client-orders';
import { parseQueueParams, queueHref } from '../lib/allocation-queue';

describe('new customers (David, 3 Nov, answer 4)', () => {
  it('builds the page address and labels for the business’s country', () => {
    expect(requestPageUrl('https://staging.cropwms.com/', 'cfy')).toBe('https://staging.cropwms.com/request/cfy');
    expect(placeLabels('US')).toMatchObject({ region: 'State', postcode: 'ZIP code' });
    expect(placeLabels('AU').postcode).toBe('Postcode');
    expect(REQUEST_FIELDS).toContain('website');
  });

  it('words statuses and shows the view only when it has something', () => {
    expect(requestStatus('new')).toEqual(['New', 'warn']);
    expect(requestStatus('accepted')[0]).toBe('Accepted');
    expect(hasCustomers(null)).toBe(false);
    expect(hasCustomers({ customerPage: false, customerRequests: 0 })).toBe(false);
    expect(hasCustomers({ customerPage: true })).toBe(true);
    expect(hasCustomers({ customerRequests: 2 })).toBe(true);
  });

  it('keeps the customers view in the address', () => {
    const p = parseQueueParams({ view: 'customers' });
    expect(p.view).toBe('customers');
    expect(queueHref(p)).toContain('view=customers');
  });
});
