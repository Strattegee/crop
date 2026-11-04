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

describe('taking the order from a request (migration 0091)', () => {
  it('reads the state the customer typed the way a site wants it', async () => {
    const { regionFor } = await import('../lib/customer-request');
    expect(regionFor('AU', 'Victoria')).toBe('VIC');
    expect(regionFor('AU', 'vic.')).toBe('VIC');
    expect(regionFor('AU', 'new south wales')).toBe('NSW');
    expect(regionFor('AU', 'Somewhere')).toBe('Somewhere');
    expect(regionFor('US', 'ca')).toBe('CA');
    expect(regionFor('NZ', 'Auckland')).toBe('Auckland');
    expect(regionFor('AU', null)).toBe('');
  });

  it('knows when an order is still to take and words one taken', async () => {
    const { needsOrder, orderTakenLine } = await import('../lib/customer-request');
    expect(needsOrder({ status: 'accepted', orderId: null })).toBe(true);
    expect(needsOrder({ status: 'accepted', orderId: 'o1' })).toBe(false);
    expect(needsOrder({ status: 'new' })).toBe(false);
    expect(orderTakenLine({ orderShifts: 2 }, 'Main shop', n => `${n} shifts`)).toBe('Order taken: 2 shifts at Main shop');
    expect(orderTakenLine({ orderShifts: 1 }, null, n => `${n} shift`)).toBe('Order taken: 1 shift');
  });
});
