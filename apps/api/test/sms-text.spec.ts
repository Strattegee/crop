import { describe, expect, it } from 'vitest';
import { offerMessage } from '../src/roster/bank-fill.js';
import { smsSize, smsText, unicodeCharacters } from '../src/notifications/sms-text.js';

describe('texts that cost less', () => {
  it('swaps punctuation that has a plain equivalent', () => {
    expect(smsText('Mon 2 Nov, 07:00–15:30 — you’re “booked”…')).toBe('Mon 2 Nov, 07:00-15:30 - you\'re "booked"...');
    expect(smsText('Shift offer · CROP\t ')).toBe('Shift offer - CROP');
  });

  it('never changes letters, so names stay as written', () => {
    expect(smsText('Hi Tāne, Café Örebro')).toBe('Hi Tāne, Café Örebro');
    expect(unicodeCharacters(smsText('Hi Tāne, Café'))).toEqual(['ā']); // é is in the GSM alphabet
  });

  it('counts parts as the provider bills them', () => {
    expect(smsSize('a'.repeat(160))).toEqual({ encoding: 'gsm', length: 160, parts: 1 });
    expect(smsSize('a'.repeat(161)).parts).toBe(2);
    expect(smsSize('a'.repeat(306)).parts).toBe(2);
    expect(smsSize('a'.repeat(307)).parts).toBe(3);
    expect(smsSize('€'.repeat(80))).toEqual({ encoding: 'gsm', length: 160, parts: 1 }); // extension characters count twice
    expect(smsSize('–'.repeat(70))).toEqual({ encoding: 'unicode', length: 70, parts: 1 });
    expect(smsSize('–'.repeat(71)).parts).toBe(2);
  });

  it('an offer text with its link goes as two plain parts instead of four Unicode ones', () => {
    const link = `https://staging.cropwms.com/offer/${'x'.repeat(43)}`;
    const { sms } = offerMessage('Ana', 'Demo Cafe', { role: 'Chef', localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', facilityName: 'Harbour Kitchen', areaName: 'Kitchen' }, null, link);
    expect(smsSize(sms)).toMatchObject({ encoding: 'unicode', parts: 4 });
    expect(smsSize(smsText(sms))).toMatchObject({ encoding: 'gsm', parts: 2 });
  });
});
