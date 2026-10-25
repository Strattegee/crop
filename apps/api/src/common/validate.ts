import { BadRequestException } from '@nestjs/common';

/** Small input checks for request bodies. Each throws a 400 with a plain-English message. */
type Body = Record<string, unknown> | undefined | null;

/** Field names as people see them, so error messages read naturally in the app. */
const LABELS: Record<string, string> = {
  firstName: 'First name', lastName: 'Last name', preferredName: 'Preferred name', email: 'Email', phone: 'Mobile',
  roles: 'Roles', notes: 'Notes', status: 'Status', name: 'Name', category: 'Category', timezone: 'Time zone',
  credentialTypeId: 'Credential', number: 'Number', issueDate: 'Issue date', expiryDate: 'Expiry date',
  reason: 'Reason', note: 'Note', role: 'Role', scope: 'Applies to', severity: 'Type',
  verificationMethod: 'How it is verified', abn: 'ABN', billingContactName: 'Billing contact', billingEmail: 'Billing email',
  addressLine: 'Address', suburb: 'Suburb', state: 'State', postcode: 'Postcode', clientId: 'Client', specialty: 'Specialty',
  parkingNotes: 'Parking notes', entryNotes: 'Entry notes',
  citizenProofType: 'Proof of citizenship', documentNumber: 'Document number', visaType: 'Visa type', visaSubclass: 'Visa subclass',
  visaGrantNumber: 'Visa grant number', visaExpiry: 'Visa expiry', workLimit: 'Work conditions', workHoursPerFortnight: 'Hours per fortnight',
  vevoCheckedOn: 'VEVO check date', vevoResult: 'VEVO result', channel: 'Channel', to: 'Mobile number', smsMonthlyCap: 'Monthly SMS limit', minRestHours: 'Minimum rest between shifts', verificationUrl: 'Verification link', expiringWindowDays: 'Expiring window',
  code: 'Code', startTime: 'Start time', endTime: 'End time', breakMinutes: 'Break (minutes)', quantity: 'Number of people',
  date: 'Date', startDate: 'Start date', endDate: 'End date', employmentType: 'Employment type', startsOn: 'Start date',
  facilityId: 'Site', areaId: 'Area', shiftCodeId: 'Shift code', workerId: 'Person',
  equipmentTypeId: 'Equipment type', equipmentId: 'Equipment', assetNumber: 'Asset number', registration: 'Registration',
  homeFacilityId: 'Home site', equipmentOnly: 'Equipment only', dueOn: 'Due date', operatorCredentialTypeId: 'Operator credential',
  unit: 'Unit', sku: 'SKU', unitCostCents: 'Unit cost (cents)', chargeCents: 'Charge to client (cents)', tracksStock: 'Count stock', active: 'Active',
  shiftId: 'Shift', workerIds: 'People', expiresInMinutes: 'Offer open for (minutes)', notify: 'Send messages',
};
const label = (key: string) => LABELS[key] ?? key;

export function text(body: Body, key: string, opts: { required?: boolean; max?: number } = {}): string | null {
  const v = body?.[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) throw new BadRequestException(`${label(key)} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new BadRequestException(`${label(key)} must be text`);
  const t = v.trim();
  if (t.length > (opts.max ?? 500)) throw new BadRequestException(`${label(key)} is too long (max ${opts.max ?? 500})`);
  return t;
}

export function date(body: Body, key: string, opts: { required?: boolean } = {}): string | null {
  const v = text(body, key, { required: opts.required, max: 10 });
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) {
    throw new BadRequestException(`${label(key)} must be a date (YYYY-MM-DD)`);
  }
  return v;
}

export function oneOf<T extends string>(body: Body, key: string, values: readonly T[], opts: { required?: boolean } = {}): T | null {
  const v = text(body, key, { required: opts.required, max: 50 });
  if (v === null) return null;
  if (!values.includes(v as T)) throw new BadRequestException(`${label(key)} must be one of: ${values.join(', ')}`);
  return v as T;
}

export function bool(body: Body, key: string): boolean | null {
  const v = body?.[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'boolean') throw new BadRequestException(`${label(key)} must be true or false`);
  return v;
}

export function int(body: Body, key: string, min: number, max: number): number | null {
  const v = body?.[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${label(key)} must be a whole number from ${min} to ${max}`);
  return v;
}

export function textList(body: Body, key: string, opts: { max?: number; itemMax?: number } = {}): string[] | null {
  const v = body?.[key];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new BadRequestException(`${label(key)} must be a list of text`);
  const items = [...new Set((v as string[]).map(x => x.trim()).filter(Boolean))];
  if (items.length > (opts.max ?? 20) || items.some(x => x.length > (opts.itemMax ?? 40))) throw new BadRequestException(`${label(key)} has too many or too long items`);
  return items;
}

export function email(body: Body, key: string): string | null {
  const v = text(body, key, { max: 200 });
  if (v === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new BadRequestException(`${label(key)} must be an email address`);
  return v.toLowerCase();
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
