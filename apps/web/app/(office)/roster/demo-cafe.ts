/**
 * Staging demo: "The Grand Café", a large café in Victoria. Every person is invented; certificate numbers are
 * DEMO placeholders. Roles and requirements are an example employer configuration, not legal requirements.
 * Built only through the public API, so the demo exercises the same rules as real use. Evening shifts carry the
 * "Serves alcohol" duty and the site has a food safety supervisor cover rule, so both show in the demo.
 */
import { api } from '../../../lib/api';
import { completeDemoCredentials } from '../demo-tools';

type Id = { id: string };
const post = <T = Id>(p: string, body: unknown) => api<T>(p, { method: 'POST', body });

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Credential library (category, has number, expiry in years; null = no expiry). */
const LIBRARY: Record<string, { category: string; number: boolean; years: number | null; method: string }> = {
  'Food Handler Training': { category: 'training', number: false, years: null, method: 'Sight certificate' },
  'Food Safety Supervisor Certificate': { category: 'training', number: true, years: 5, method: 'Sight certificate (within 5 years)' },
  'Allergen Awareness Training': { category: 'training', number: false, years: 2, method: 'Sight certificate' },
  'Responsible Service of Alcohol (RSA)': { category: 'licence', number: true, years: 3, method: 'Check Liquor Control Victoria RSA record' },
  'First Aid (HLTAID011)': { category: 'training', number: true, years: 3, method: 'Sight statement of attainment' },
  'CPR (HLTAID009)': { category: 'training', number: true, years: 1, method: 'Sight statement of attainment' },
  'Manual Handling Training': { category: 'training', number: false, years: 2, method: 'Internal training record' },
  'Chemical Handling (SDS) Training': { category: 'training', number: false, years: null, method: 'Internal training record' },
  'Espresso Machine Competency': { category: 'training', number: false, years: null, method: 'Sign-off by Head Barista' },
  'Kitchen Equipment Sign-off': { category: 'training', number: false, years: null, method: 'Sign-off by Head Chef' },
  'Certificate III in Commercial Cookery': { category: 'training', number: true, years: null, method: 'Sight qualification' },
  'Certificate IV in Kitchen Management': { category: 'training', number: true, years: null, method: 'Sight qualification' },
  'Apprenticeship Enrolment': { category: 'registration', number: true, years: 3, method: 'Check training contract' },
  'Driver Licence (Car)': { category: 'licence', number: true, years: 5, method: 'Sight licence' },
};

/** Role → requirements. H = must hold (blocks rostering), W = should hold (warning only). */
const ROLES: Record<string, Record<string, 'H' | 'W'>> = {
  'General Manager': { 'Food Safety Supervisor Certificate': 'H', 'Responsible Service of Alcohol (RSA)': 'H', 'First Aid (HLTAID011)': 'W' },
  'Duty Manager': { 'Food Handler Training': 'H', 'Responsible Service of Alcohol (RSA)': 'H', 'First Aid (HLTAID011)': 'H', 'CPR (HLTAID009)': 'W', 'Food Safety Supervisor Certificate': 'W' },
  'FOH Supervisor': { 'Food Handler Training': 'H', 'Responsible Service of Alcohol (RSA)': 'H', 'First Aid (HLTAID011)': 'W' },
  'Head Barista': { 'Food Handler Training': 'H', 'Espresso Machine Competency': 'H', 'Allergen Awareness Training': 'H' },
  'Barista': { 'Food Handler Training': 'H', 'Espresso Machine Competency': 'H', 'Allergen Awareness Training': 'H' },
  'Waitstaff': { 'Food Handler Training': 'H', 'Allergen Awareness Training': 'H', 'Responsible Service of Alcohol (RSA)': 'W' },
  'Food Runner': { 'Food Handler Training': 'H', 'Allergen Awareness Training': 'H', 'Manual Handling Training': 'H' },
  'Head Chef': { 'Certificate III in Commercial Cookery': 'H', 'Food Safety Supervisor Certificate': 'H', 'Allergen Awareness Training': 'H', 'Certificate IV in Kitchen Management': 'W' },
  'Sous Chef': { 'Certificate III in Commercial Cookery': 'H', 'Food Handler Training': 'H', 'Allergen Awareness Training': 'W', 'Food Safety Supervisor Certificate': 'W' },
  'Chef de Partie': { 'Certificate III in Commercial Cookery': 'H', 'Food Handler Training': 'H', 'Allergen Awareness Training': 'H', 'Kitchen Equipment Sign-off': 'H' },
  'Cook': { 'Food Handler Training': 'H', 'Allergen Awareness Training': 'H', 'Kitchen Equipment Sign-off': 'H' },
  'Apprentice Chef': { 'Apprenticeship Enrolment': 'H', 'Food Handler Training': 'H', 'Kitchen Equipment Sign-off': 'H' },
  'Kitchen Hand': { 'Food Handler Training': 'H', 'Chemical Handling (SDS) Training': 'H', 'Manual Handling Training': 'H', 'Kitchen Equipment Sign-off': 'W' },
  'Stock Coordinator': { 'Manual Handling Training': 'H', 'Food Handler Training': 'W' },
  'Administration Officer': {},
};

type Emp = { first: string; last: string; roles: string[]; type: 'full_time' | 'part_time' | 'casual' | 'bank'; hours?: number; extra?: string[] };
/** 32 invented staff. Some hold two roles; a few casuals are "bank" relief staff. */
const STAFF: Emp[] = [
  { first: 'Helen', last: 'Marsh', roles: ['General Manager'], type: 'full_time', hours: 38, extra: ['Driver Licence (Car)'] },
  { first: 'Tom', last: 'Okafor', roles: ['Duty Manager', 'FOH Supervisor'], type: 'full_time', hours: 38 },
  { first: 'Priya', last: 'Nair', roles: ['Duty Manager', 'Waitstaff'], type: 'part_time', hours: 30 },
  { first: 'Josh', last: 'Kelly', roles: ['FOH Supervisor', 'Waitstaff'], type: 'part_time', hours: 25 },
  { first: 'Leah', last: 'Tran', roles: ['FOH Supervisor', 'Barista'], type: 'casual' },
  { first: 'Marco', last: 'Bellini', roles: ['Head Barista', 'Barista'], type: 'full_time', hours: 38 },
  { first: 'Mia', last: 'Chen', roles: ['Barista'], type: 'part_time', hours: 24 },
  { first: 'Oscar', last: 'Diaz', roles: ['Barista', 'Waitstaff'], type: 'casual' },
  { first: 'Ruby', last: 'Walsh', roles: ['Barista'], type: 'casual' },
  { first: 'Sana', last: 'Malik', roles: ['Barista'], type: 'bank' },
  { first: 'Alex', last: 'Rivera', roles: ['Waitstaff'], type: 'part_time', hours: 20 },
  { first: 'Bella', last: 'Nguyen', roles: ['Waitstaff'], type: 'casual' },
  { first: 'Chris', last: 'Doyle', roles: ['Waitstaff', 'Food Runner'], type: 'casual' },
  { first: 'Dana', last: 'Fraser', roles: ['Waitstaff'], type: 'part_time', hours: 24 },
  { first: 'Ella', last: 'Gordon', roles: ['Waitstaff'], type: 'casual' },
  { first: 'Finn', last: 'Hughes', roles: ['Waitstaff'], type: 'bank' },
  { first: 'Grace', last: 'Ito', roles: ['Waitstaff'], type: 'casual' },
  { first: 'Hamish', last: 'Kerr', roles: ['Food Runner'], type: 'casual', extra: ['Driver Licence (Car)'] },
  { first: 'Isla', last: 'Lam', roles: ['Food Runner', 'Waitstaff'], type: 'casual' },
  { first: 'Jack', last: 'Moran', roles: ['Food Runner'], type: 'bank', extra: ['Driver Licence (Car)'] },
  { first: 'Nadia', last: 'Petrov', roles: ['Head Chef'], type: 'full_time', hours: 38 },
  { first: 'Luca', last: 'Romano', roles: ['Sous Chef', 'Chef de Partie'], type: 'full_time', hours: 38 },
  { first: 'Kiri', last: 'Ngata', roles: ['Chef de Partie', 'Cook'], type: 'full_time', hours: 38 },
  { first: 'Ben', last: 'Foster', roles: ['Chef de Partie'], type: 'part_time', hours: 30 },
  { first: 'Sam', last: 'Turner', roles: ['Cook'], type: 'part_time', hours: 24 },
  { first: 'Lucy', last: 'Park', roles: ['Cook'], type: 'casual' },
  { first: 'Ethan', last: 'Brooks', roles: ['Apprentice Chef'], type: 'full_time', hours: 38 },
  { first: 'Omar', last: 'Haddad', roles: ['Kitchen Hand'], type: 'part_time', hours: 25 },
  { first: 'Zoe', last: 'Clarke', roles: ['Kitchen Hand'], type: 'casual' },
  { first: 'Ravi', last: 'Patel', roles: ['Kitchen Hand'], type: 'bank' },
  { first: 'Wendy', last: 'Lowe', roles: ['Stock Coordinator'], type: 'part_time', hours: 16, extra: ['Driver Licence (Car)'] },
  { first: 'Grant', last: 'Ellis', roles: ['Administration Officer'], type: 'part_time', hours: 16 },
];

/** Deliberate gaps, so the demo shows CROP catching them. Expiry offsets are days from today. */
const EXCEPTIONS: Record<string, Record<string, 'missing' | number>> = {
  'Alex Rivera': { 'Responsible Service of Alcohol (RSA)': -12 },        // RSA expired: warning for waitstaff
  'Mia Chen': { 'Allergen Awareness Training': 9 },                      // expiring soon: warning
  'Sam Turner': { 'Food Handler Training': 'missing' },                  // can't be rostered as a cook
  'Priya Nair': { 'First Aid (HLTAID011)': -5 },                         // can't work as Duty Manager, can as waitstaff
  'Hamish Kerr': { 'Driver Licence (Car)': 20 },
};

type ShiftSpec = { area: string; code: string; role: string; days: number[]; qty?: number; leaveOpen?: number[]; duties?: string[] };

export async function loadCafeDemo(week: string, today: string) {
  const site = (await post('/facilities', { name: 'The Grand Café', state: 'VIC', suburb: 'Fitzroy', addressLine: '1 Example Street', postcode: '3065' })).id;
  const areaIds: Record<string, string> = {};
  for (const a of ['Front of House', 'Coffee Bar', 'Kitchen', 'Back Office']) areaIds[a] = (await post(`/facilities/${site}/areas`, { name: a })).id;

  const codes: Record<string, string> = {};
  for (const [code, name, s, e, brk] of [
    ['EARLY', 'Breakfast', '06:30', '14:30', 30], ['MID', 'Lunch', '10:00', '16:00', 30], ['CLOSE', 'Dinner', '15:30', '22:30', 30],
    ['K-AM', 'Kitchen early', '06:00', '14:00', 30], ['K-PM', 'Kitchen late', '14:00', '22:00', 30], ['OFFICE', 'Office day', '09:00', '17:00', 30],
  ] as const) codes[code] = (await post('/shift-codes', { code, name, startTime: s, endTime: e, breakMinutes: brk, facilityId: site })).id;

  // Credential library and role requirements.
  const types: Record<string, string> = {};
  for (const [name, t] of Object.entries(LIBRARY)) {
    types[name] = (await post('/credential-types', {
      name, category: t.category, hasNumber: t.number, hasExpiry: t.years !== null, needsEvidence: false, verificationMethod: t.method,
    })).id;
  }
  for (const [role, reqs] of Object.entries(ROLES)) {
    for (const [cred, sev] of Object.entries(reqs)) {
      await post('/credential-requirements', { credentialTypeId: types[cred], scope: 'role', role, severity: sev === 'H' ? 'hard' : 'warning' });
    }
  }

  // Staff, right to work, employment terms and credentials (verified), in small batches.
  const ids: Record<string, { id: string; e: Emp }> = {};
  let n = 1000;
  const addPerson = async (e: Emp) => {
    const name = `${e.first} ${e.last}`;
    const w = (await post('/workers', { firstName: e.first, lastName: e.last, roles: e.roles, email: `${e.first.toLowerCase()}.${e.last.toLowerCase()}@example.com` })).id;
    ids[name] = { id: w, e };
    await api(`/workers/${w}/right-to-work`, { method: 'PUT', body: { status: 'citizen', citizenProofType: 'au_passport', documentNumber: 'DEMO0000' } });
    await post(`/workers/${w}/right-to-work/verify`, { note: 'Demo data' });
    await post(`/workers/${w}/employment`, { employmentType: e.type, contractedHours: e.hours, startsOn: '2026-01-01' });
    const needed = new Set<string>([...e.roles.flatMap(r => Object.keys(ROLES[r] ?? {})), ...(e.extra ?? [])]);
    for (const cred of needed) {
      const ex = EXCEPTIONS[name]?.[cred];
      if (ex === 'missing') continue;
      const t = LIBRARY[cred];
      const expiry = t.years === null ? undefined : typeof ex === 'number' ? addDays(today, ex) : addDays(today, 120 + ((n * 37) % 600));
      const issue = expiry ? addDays(expiry, -365 * (t.years ?? 1)) : addDays(today, -400 - (n % 300));
      const c = await post(`/workers/${w}/credentials`, {
        credentialTypeId: types[cred], number: t.number ? `DEMO-${n}` : undefined, issueDate: issue < today ? issue : addDays(today, -30), expiryDate: expiry,
      });
      n++;
      await post(`/workers/${w}/credentials/${c.id}/verify`, { note: 'Demo data' });
    }
  };
  for (let i = 0; i < STAFF.length; i += 4) await Promise.all(STAFF.slice(i, i + 4).map(addPerson));

  // The business may already have its own rules (e.g. a police check for everyone): meet those too.
  await completeDemoCredentials({ workerIds: Object.values(ids).map(p => p.id), businessWideOnly: true });

  // Shift duties: evening shifts serve alcohol, so whoever works them needs a current RSA (Alex Rivera's has run out,
  // so he can work days but not the bar). A business that already has the duty (from an industry template) keeps its own.
  const duties: Record<string, string> = {};
  const existingDuties = await api<{ id: string; name: string; active: boolean }[]>('/shift-duties').catch(() => []);
  const serves = existingDuties.find(x => x.name.toLowerCase() === 'serves alcohol' && x.active);
  duties['Serves alcohol'] = serves?.id ?? (await post('/shift-duties', {
    name: 'Serves alcohol', description: 'Bar service on this shift', requirements: [{ credentialTypeId: types['Responsible Service of Alcohol (RSA)'], severity: 'hard' }],
  })).id;
  // Cover rule: a food safety supervisor whenever anyone is working. The head chef and manager cover weekdays;
  // late and weekend shifts show as cover gaps on the roster.
  await post('/cover-rules', { credentialTypeId: types['Food Safety Supervisor Certificate'], facilityId: site }).catch(() => undefined);

  // Equipment and consumables.
  const vanType = (await post('/equipment-types', { name: 'Van', operatorCredentialTypeId: types['Driver Licence (Car)'] })).id;
  const espressoType = (await post('/equipment-types', { name: 'Espresso machine' })).id;
  const van = (await post('/equipment', { equipmentTypeId: vanType, name: 'Catering van', registration: 'DEMO01', homeFacilityId: site })).id;
  await post(`/equipment/${van}/checks`, { name: 'Registration', dueOn: addDays(today, 21) });
  await post(`/equipment/${van}/checks`, { name: 'Service', dueOn: addDays(today, 75) });
  const machine = (await post('/equipment', { equipmentTypeId: espressoType, name: 'Espresso machine (3 group)', homeFacilityId: site })).id;
  await post(`/equipment/${machine}/checks`, { name: 'Service', dueOn: addDays(today, 6) });
  await post(`/equipment/${machine}/checks`, { name: 'Electrical test and tag', dueOn: addDays(today, 140) });

  const items: Record<string, string> = {};
  for (const [name, category, unit, cost, charge, reorder, stock] of [
    ['Disposable gloves (box of 100)', 'ppe', 'box', 1200, null, 10, 40], ['Apron', 'ppe', 'each', 1500, null, 5, 20],
    ['Milk', 'sundries', 'litre', 180, null, 60, 240], ['Coffee beans', 'sundries', 'kg', 3800, null, 10, 45],
    ['Catering platter boxes', 'sundries', 'each', 250, 400, 20, 80],
  ] as const) {
    items[name] = (await post('/items', { name, category, unit, unitCostCents: cost, chargeCents: charge ?? undefined, tracksStock: true, reorderLevel: reorder })).id;
    await post(`/items/${items[name]}/receive`, { facilityId: site, quantity: stock, notes: 'Opening stock (demo)' });
  }
  for (const who of ['Bella Nguyen', 'Ella Gordon', 'Zoe Clarke']) await post(`/items/${items['Apron']}/issue`, { facilityId: site, quantity: 1, workerId: ids[who].id });

  // A week of shifts. Days: 0 = Monday … 6 = Sunday.
  const all = [0, 1, 2, 3, 4, 5, 6], wk = [0, 1, 2, 3, 4], weekend = [5, 6], late = [3, 4, 5];
  const plan: ShiftSpec[] = [
    { area: 'Back Office', code: 'OFFICE', role: 'General Manager', days: wk },
    { area: 'Front of House', code: 'EARLY', role: 'Duty Manager', days: all },
    { area: 'Front of House', code: 'CLOSE', role: 'Duty Manager', days: late, duties: ['Serves alcohol'] },
    { area: 'Front of House', code: 'MID', role: 'FOH Supervisor', days: all },
    { area: 'Coffee Bar', code: 'EARLY', role: 'Head Barista', days: wk },
    { area: 'Coffee Bar', code: 'EARLY', role: 'Barista', days: all, qty: 2, leaveOpen: [6] },
    { area: 'Coffee Bar', code: 'MID', role: 'Barista', days: weekend },
    { area: 'Front of House', code: 'EARLY', role: 'Waitstaff', days: all, qty: 2 },
    { area: 'Front of House', code: 'MID', role: 'Waitstaff', days: all, qty: 2, leaveOpen: [5] },
    { area: 'Front of House', code: 'CLOSE', role: 'Waitstaff', days: late, qty: 2, leaveOpen: [4], duties: ['Serves alcohol'] },
    { area: 'Front of House', code: 'MID', role: 'Food Runner', days: all },
    { area: 'Kitchen', code: 'K-AM', role: 'Head Chef', days: wk },
    { area: 'Kitchen', code: 'K-AM', role: 'Sous Chef', days: weekend },
    { area: 'Kitchen', code: 'K-PM', role: 'Sous Chef', days: late },
    { area: 'Kitchen', code: 'K-AM', role: 'Chef de Partie', days: all },
    { area: 'Kitchen', code: 'K-PM', role: 'Chef de Partie', days: late, leaveOpen: [5] },
    { area: 'Kitchen', code: 'K-AM', role: 'Cook', days: all },
    { area: 'Kitchen', code: 'K-AM', role: 'Apprentice Chef', days: wk },
    { area: 'Kitchen', code: 'K-AM', role: 'Kitchen Hand', days: all },
    { area: 'Kitchen', code: 'K-PM', role: 'Kitchen Hand', days: late, leaveOpen: [3] },
    { area: 'Back Office', code: 'OFFICE', role: 'Stock Coordinator', days: [0, 3] },
    { area: 'Back Office', code: 'OFFICE', role: 'Administration Officer', days: [1, 3] },
  ];
  const open = new Set<string>(); // shift ids to leave open on purpose
  for (const s of plan) {
    for (const d of s.days) {
      const res = await post<{ ids: string[] }>('/shifts', {
        facilityId: site, areaId: areaIds[s.area], shiftCodeId: codes[s.code], role: s.role, date: addDays(week, d), quantity: s.qty ?? 1,
        dutyIds: (s.duties ?? []).map(x => duties[x]),
      });
      if (s.leaveOpen?.includes(d)) open.add(res.ids[res.ids.length - 1]);
    }
  }
  // Saturday catering delivery: a food runner with the van.
  const delivery = (await post<{ ids: string[] }>('/shifts', {
    facilityId: site, areaId: areaIds['Front of House'], role: 'Food Runner', date: addDays(week, 5), startTime: '08:00', endTime: '12:00', notes: 'Catering delivery: 40 platters to an offsite event',
  })).ids[0];

  // The delivery goes to a licensed runner with the van, and uses platter boxes.
  try {
    await post(`/shifts/${delivery}/assign`, { workerId: ids['Hamish Kerr'].id });
    await post(`/shifts/${delivery}/confirm`, {});
    await post(`/shifts/${delivery}/equipment`, { equipmentId: van });
    await post(`/items/${items['Catering platter boxes']}/issue`, { facilityId: site, quantity: 40, shiftId: delivery });
  } catch { /* leave it for the demo */ }
  open.add(delivery);

  // Fill: for each shift, try people with the role, fewest hours first; leave the chosen ones open.
  type S = { id: string; role: string; hours: number; localDate: string };
  const shifts = await api<S[]>(`/shifts?from=${week}&to=${addDays(week, 6)}`);
  const hours: Record<string, number> = { [ids['Hamish Kerr'].id]: 4 };
  const byRole = (role: string) => Object.values(ids).filter(p => p.e.roles.includes(role))
    .sort((a, b) => (hours[a.id] ?? 0) - (hours[b.id] ?? 0) || a.e.roles.indexOf(role) - b.e.roles.indexOf(role));
  let k = 0;
  for (const s of shifts) {
    if (open.has(s.id)) continue;
    for (const p of byRole(s.role)) {
      const cap = (p.e.hours ?? 24) + 2;
      if ((hours[p.id] ?? 0) + s.hours > cap) continue;
      try {
        await post(`/shifts/${s.id}/assign`, { workerId: p.id });
        if (k++ % 9 !== 4) await post(`/shifts/${s.id}/confirm`, {}); // most booked, a few still waiting to confirm
        hours[p.id] = (hours[p.id] ?? 0) + s.hours;
        break;
      } catch { /* not eligible or clashes: try the next person */ }
    }
  }
  const milkShifts = shifts.filter(s => s.role === 'Barista').slice(0, 6);
  for (const s of milkShifts) await post(`/items/${items['Milk']}/issue`, { facilityId: site, quantity: 18, shiftId: s.id });
}
