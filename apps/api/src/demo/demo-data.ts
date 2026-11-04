/**
 * The invented business for the demo-day seed (David, 3 Nov 2026: "work the Allocations screen like a normal day").
 * Everything here is made up: offices, clients, sites, wards, contacts and people. The shape (a nursing and care
 * agency filling 200–300 client shifts a day across hospitals, aged care, disability houses and a little labour hire)
 * follows what a real agency's day looks like; no name, place, number or note comes from a real business.
 * Emails are only ever at example.com (the app never sends to it) and nobody has a phone number (staging sends real SMS).
 */

export interface OfficeDef { key: string; name: string; state: string }
export const OFFICES: OfficeDef[] = [
  { key: 'mel', name: 'VIC Melbourne Central', state: 'VIC' },
  { key: 'bay', name: 'VIC Bayside & Peninsula', state: 'VIC' },
  { key: 'gee', name: 'VIC Geelong & Surf Coast', state: 'VIC' },
  { key: 'bal', name: 'VIC Ballarat & Goldfields', state: 'VIC' },
  { key: 'sun', name: 'QLD Sunshine Coast', state: 'QLD' },
];

/** The invented allocation officers (sign-ins that can never be used: their subject isn't one the identity provider issues). */
export interface OfficerDef { key: string; first: string; last: string; office: string | null }
export const OFFICERS: OfficerDef[] = [
  { key: 'nadia', first: 'Nadia', last: 'Haddad', office: 'mel' },
  { key: 'callum', first: 'Callum', last: 'Brennan', office: 'mel' },
  { key: 'tahlia', first: 'Tahlia', last: 'Morgan', office: 'bay' },
  { key: 'ravi', first: 'Ravi', last: 'Menon', office: 'gee' },
  { key: 'adaeze', first: 'Adaeze', last: 'Okafor', office: 'bal' },
  { key: 'lachlan', first: 'Lachlan', last: 'Pike', office: 'sun' },
  { key: 'bianca', first: 'Bianca', last: 'Russo', office: null },
];
export const OFFICER_SUBJECT = (slug: string, key: string) => `demo-day:${slug}:${key}`;
export const officerEmail = (o: OfficerDef) => `demo.${o.first}.${o.last}@example.com`.toLowerCase();

/** Kinds of area: each has its own daily pattern of shifts (see SLOTS). */
export type AreaKind = 'ward' | 'ed' | 'rehab' | 'dayproc' | 'aged' | 'memory' | 'mh' | 'sil' | 'community' | 'warehouse';

export interface SiteDef { key: string; name: string; suburb: string; postcode: string; office: string; areas: [string, AreaKind][]; address: string; parking?: string; entry?: string }
export interface ContactDef { name: string; position: string }
export interface ClientDef {
  key: string; name: string; rank: number | null; confirms: boolean; refPrefix: string | null; kind: string;
  notes: string; contacts: ContactDef[]; sites: SiteDef[];
}

export const CLIENTS: ClientDef[] = [
  {
    key: 'riverbend', name: 'Riverbend Health Service', rank: 1, confirms: false, refPrefix: 'RHS-', kind: 'Public hospital',
    notes: 'Book through the staffing office. Same-day changes by phone to the after-hours coordinator. Staff report to the nurse in charge of the ward.',
    contacts: [{ name: 'Marguerite Ellison', position: 'Staffing office manager' }, { name: 'Dominic Achebe', position: 'After-hours coordinator' }, { name: 'Fiona Lindqvist', position: 'Nurse unit manager, Ward 3 North' }],
    sites: [
      { key: 'rb-hosp', name: 'Riverbend Hospital', suburb: 'Preston', postcode: '3072', office: 'mel', address: '210 Tamarind Road',
        areas: [['Ward 3 North', 'ward'], ['Ward 4 South', 'ward'], ['Emergency Department', 'ed']],
        parking: 'Staff car park off the side street; ask security for a day pass.', entry: 'Sign in at the staffing office on level 1 before going to the ward.' },
      { key: 'rb-rehab', name: 'Riverbend Rehabilitation Centre', suburb: 'Reservoir', postcode: '3073', office: 'mel', address: '18 Coolabah Avenue',
        areas: [['Rehab Ward A', 'rehab'], ['Rehab Ward B', 'rehab']] },
    ],
  },
  {
    key: 'kestrel', name: 'Kestrel Private Hospital', rank: 2, confirms: true, refPrefix: 'KPH', kind: 'Private hospital',
    notes: 'Confirms every booking by email. Theatre staff need their own enclosed shoes. Invoices to the accounts team monthly.',
    contacts: [{ name: 'Annika Sorensen', position: 'Director of nursing' }, { name: 'Tobias Mwale', position: 'Bed and staffing coordinator' }],
    sites: [
      { key: 'kph', name: 'Kestrel Private Hospital', suburb: 'Kew', postcode: '3101', office: 'mel', address: '45 Pelham Rise',
        areas: [['Surgical Ward', 'ward'], ['Orthopaedic Ward', 'ward'], ['Day Procedure Unit', 'dayproc']], entry: 'Main entrance, then the nurse coordinator on the ground floor.' },
    ],
  },
  {
    key: 'silverwattle', name: 'Silverwattle Aged Care', rank: 1, confirms: true, refPrefix: 'SW/', kind: 'Aged care (not for profit)',
    notes: 'Each home books its own shifts. Please confirm the name back to the home, not head office. New staff get a 15-minute orientation from the RN in charge.',
    contacts: [{ name: 'Rosalind Petrakis', position: 'Rostering, Coburg' }, { name: 'Haruto Saito', position: 'Facility manager, Essendon' }, { name: 'Yvette Lamarque', position: 'Care manager, Footscray' }],
    sites: [
      { key: 'sw-cob', name: 'Silverwattle Coburg', suburb: 'Coburg', postcode: '3058', office: 'mel', address: '7 Ironwood Street',
        areas: [['Banksia Wing', 'aged'], ['Wattle Wing', 'aged'], ['Memory Support Unit', 'memory']], parking: 'Street parking only.' },
      { key: 'sw-ess', name: 'Silverwattle Essendon', suburb: 'Essendon', postcode: '3040', office: 'mel', address: '92 Lilly Pilly Lane',
        areas: [['Grevillea Wing', 'aged'], ['Kurrajong Wing', 'aged']] },
      { key: 'sw-foo', name: 'Silverwattle Footscray', suburb: 'Footscray', postcode: '3011', office: 'mel', address: '3 Saltwater Crescent',
        areas: [['Main House', 'aged']] },
    ],
  },
  {
    key: 'lyrebird', name: 'Lyrebird Mental Health Clinic', rank: 2, confirms: true, refPrefix: 'LMH', kind: 'Private mental health',
    notes: 'Mental health experience required for every shift. Staff collect a duress alarm at reception.',
    contacts: [{ name: 'Celeste Varga', position: 'Nurse unit manager' }],
    sites: [
      { key: 'lyre', name: 'Lyrebird Clinic', suburb: 'Camberwell', postcode: '3124', office: 'mel', address: '128 Myrtle Parade',
        areas: [['Acute Unit', 'mh'], ['Step-down Unit', 'mh']], entry: 'Collect a duress alarm and keys at reception.' },
    ],
  },
  {
    key: 'quandong', name: 'Quandong Day Surgery', rank: null, confirms: false, refPrefix: null, kind: 'Day surgery',
    notes: 'Weekdays only. Lists sometimes finish early; staff are paid the booked hours.',
    contacts: [{ name: 'Isidore Laurent', position: 'Theatre manager' }],
    sites: [
      { key: 'quan', name: 'Quandong Day Surgery', suburb: 'Moonee Ponds', postcode: '3039', office: 'mel', address: '61 Brolga Street',
        areas: [['Theatre Recovery', 'dayproc'], ['Admissions', 'dayproc']] },
    ],
  },
  {
    key: 'kookaburra', name: 'Kookaburra Freight & Cold Store', rank: 5, confirms: false, refPrefix: 'KFC-', kind: 'Warehousing (labour hire)',
    notes: 'Steel-cap boots and hi-vis required. Cold store shifts: thermal gear supplied on site.',
    contacts: [{ name: 'Brendan Kowalczyk', position: 'Shift manager' }],
    sites: [
      { key: 'kook', name: 'Kookaburra Laverton North DC', suburb: 'Laverton North', postcode: '3026', office: 'mel', address: '400 Freightway Drive',
        areas: [['Cold Store', 'warehouse'], ['Dispatch', 'warehouse']], entry: 'Gatehouse sign-in; induction video on the first shift.' },
    ],
  },
  {
    key: 'ironbark', name: 'Ironbark Disability Services', rank: 4, confirms: true, refPrefix: 'IDS', kind: 'Disability (supported independent living)',
    notes: 'Read the house folder at the start of each shift. Some shifts include driving residents in the house car.',
    contacts: [{ name: 'Matthias Oyelaran', position: 'Rostering coordinator' }, { name: 'Leonie Fairweather', position: 'House supervisor' }],
    sites: [
      { key: 'ib-tho', name: 'Ironbark House Thornbury', suburb: 'Thornbury', postcode: '3071', office: 'mel', address: '22 Quokka Close', areas: [['House', 'sil']] },
      { key: 'ib-bun', name: 'Ironbark House Bundoora', suburb: 'Bundoora', postcode: '3083', office: 'mel', address: '9 Numbat Way', areas: [['House', 'sil']] },
      { key: 'ib-men', name: 'Ironbark House Mentone', suburb: 'Mentone', postcode: '3194', office: 'bay', address: '14 Sandpiper Court', areas: [['House', 'sil']] },
      { key: 'ib-gro', name: 'Ironbark House Grovedale', suburb: 'Grovedale', postcode: '3216', office: 'gee', address: '5 Spinifex Road', areas: [['House', 'sil']] },
    ],
  },
  {
    key: 'bluegum', name: 'Bluegum Lodge Aged Care', rank: 3, confirms: false, refPrefix: 'BGL', kind: 'Aged care (private)',
    notes: 'Book by email where possible. The RN in charge signs timesheets.',
    contacts: [{ name: 'Philippa Strand', position: 'Roster coordinator' }, { name: 'Ezekiel Banda', position: 'Facility manager' }],
    sites: [
      { key: 'bg-car', name: 'Bluegum Lodge Carrum Downs', suburb: 'Carrum Downs', postcode: '3201', office: 'bay', address: '33 Paperbark Drive',
        areas: [['North Wing', 'aged'], ['South Wing', 'aged']] },
      { key: 'bg-ros', name: 'Bluegum Lodge Rosebud', suburb: 'Rosebud', postcode: '3939', office: 'bay', address: '8 Tidewater Road',
        areas: [['Seaview Wing', 'aged'], ['Memory Support', 'memory']] },
    ],
  },
  {
    key: 'saltbush', name: 'Saltbush Rehabilitation Hospital', rank: 4, confirms: false, refPrefix: 'SRH', kind: 'Private rehabilitation',
    notes: 'Handover at 07:00, 13:00 and 21:30. Parking at the rear.',
    contacts: [{ name: 'Gwendolyn Achterberg', position: 'Nurse unit manager' }],
    sites: [
      { key: 'salt', name: 'Saltbush Rehabilitation Hospital', suburb: 'Mount Eliza', postcode: '3930', office: 'bay', address: '150 Clifftop Road',
        areas: [['Rehab 1', 'rehab'], ['Rehab 2', 'rehab']], parking: 'Rear car park, levels 2 and 3.' },
    ],
  },
  {
    key: 'pelican', name: 'Pelican Point Retirement Living', rank: 6, confirms: false, refPrefix: null, kind: 'Retirement living with care',
    notes: 'Small care team; mostly personal care shifts.',
    contacts: [{ name: 'Rupert Calloway', position: 'Village manager' }],
    sites: [
      { key: 'peli', name: 'Pelican Point Hastings', suburb: 'Hastings', postcode: '3915', office: 'bay', address: '2 Jetty View Road', areas: [['Care Suites', 'aged']] },
    ],
  },
  {
    key: 'harbourlight', name: 'Harbourlight Care Communities', rank: 2, confirms: true, refPrefix: 'HCC-', kind: 'Aged care (not for profit)',
    notes: 'Confirms bookings by return email. Staff park in the visitor bays on weekends only.',
    contacts: [{ name: 'Saoirse Delacroix', position: 'Workforce coordinator' }, { name: 'Kwabena Asante', position: 'Clinical care coordinator' }],
    sites: [
      { key: 'hl-bel', name: 'Harbourlight Belmont', suburb: 'Belmont', postcode: '3216', office: 'gee', address: '71 Estuary Street',
        areas: [['Bellarine Wing', 'aged'], ['Barwon Wing', 'aged']] },
      { key: 'hl-tor', name: 'Harbourlight Torquay', suburb: 'Torquay', postcode: '3228', office: 'gee', address: '19 Dunecrest Avenue', areas: [['Surf Coast House', 'aged']] },
      { key: 'hl-lar', name: 'Harbourlight Lara', suburb: 'Lara', postcode: '3212', office: 'gee', address: '6 Granite Hill Road', areas: [['Main', 'aged']] },
    ],
  },
  {
    key: 'malleerose', name: 'Mallee Rose Aged Care', rank: 5, confirms: false, refPrefix: 'MRA', kind: 'Aged care (private)',
    notes: 'Ring before 2pm for next-day shifts.',
    contacts: [{ name: 'Clementine Vu', position: 'Care manager' }],
    sites: [
      { key: 'mr-wen', name: 'Mallee Rose Wendouree', suburb: 'Wendouree', postcode: '3355', office: 'bal', address: '27 Sturt Pea Street',
        areas: [['East Wing', 'aged'], ['West Wing', 'aged']] },
      { key: 'mr-bac', name: 'Mallee Rose Bacchus Marsh', suburb: 'Bacchus Marsh', postcode: '3340', office: 'bal', address: '11 Orchard Lane', areas: [['Main', 'aged']] },
    ],
  },
  {
    key: 'graniteridge', name: 'Granite Ridge Supported Living', rank: 7, confirms: false, refPrefix: null, kind: 'Disability (supported living)',
    notes: 'Fill-in client: book only after the ranked clients are covered.',
    contacts: [{ name: 'Augustin Ferreira', position: 'Team leader' }],
    sites: [
      { key: 'gr-seb', name: 'Granite Ridge Sebastopol', suburb: 'Sebastopol', postcode: '3356', office: 'bal', address: '40 Quarry Road',
        areas: [['House 1', 'sil'], ['House 2', 'sil']] },
    ],
  },
  {
    key: 'tallowwood', name: 'Tallowwood Private Hospital', rank: 2, confirms: false, refPrefix: 'TPH', kind: 'Private hospital (Queensland)',
    notes: 'Queensland time (no daylight saving). Ward coordinators book through the after-hours line after 4pm.',
    contacts: [{ name: 'Imogen Hartley-Ngata', position: 'Nursing workforce manager' }, { name: 'Faisal Qureshi', position: 'After-hours coordinator' }],
    sites: [
      { key: 'tall', name: 'Tallowwood Private Hospital', suburb: 'Maroochydore', postcode: '4558', office: 'sun', address: '88 Coral Fern Drive',
        areas: [['Medical Ward', 'ward'], ['Surgical Ward', 'ward']] },
    ],
  },
  {
    key: 'coralbay', name: 'Coralbay Community Care', rank: 3, confirms: true, refPrefix: 'CCC', kind: 'Aged and community care (Queensland)',
    notes: 'Community shifts need a car and a current licence.',
    contacts: [{ name: 'Tamsin Oduya', position: 'Rostering lead' }, { name: 'Bartholomew Kealoha', position: 'Community services manager' }],
    sites: [
      { key: 'cb-cal', name: 'Coralbay Lodge Caloundra', suburb: 'Caloundra', postcode: '4551', office: 'sun', address: '15 Reefview Terrace',
        areas: [['Reef Wing', 'aged'], ['Dune Wing', 'aged']] },
      { key: 'cb-nam', name: 'Coralbay Lodge Nambour', suburb: 'Nambour', postcode: '4560', office: 'sun', address: '4 Cane Train Street', areas: [['Main', 'aged']] },
      { key: 'cb-noo', name: 'Coralbay Home Support Noosaville', suburb: 'Noosaville', postcode: '4566', office: 'sun', address: '29 Riverbank Parade', areas: [['Community', 'community']] },
    ],
  },
];

export const RN = 'Registered Nurse';
export const EN = 'Enrolled Nurse';
export const AIN = 'Assistant in Nursing';
export const PCW = 'Personal Care Worker';
export const DSW = 'Disability Support Worker';
export const PICK = 'Pick Packer';
export const PROCESS = 'Process Worker';
export const FORKLIFT = 'Forklift Driver';
export const STORE = 'Storeperson';

/** One shift a day pattern: role, local times, break, average number a day; `note` and `duty` sometimes. */
export interface Slot { role: string; start: string; end: string; brk: number; n: number; note?: string; duty?: string; gender?: boolean }

const MED = 'Gives medication';
const DRIVES = 'Drives clients';
export const SLOTS: Record<AreaKind, Slot[]> = {
  ward: [
    { role: RN, start: '07:00', end: '15:30', brk: 30, n: 1.8 },
    { role: RN, start: '13:00', end: '21:30', brk: 30, n: 1.4 },
    { role: RN, start: '21:30', end: '07:30', brk: 30, n: 0.9 },
    { role: EN, start: '07:00', end: '15:30', brk: 30, n: 0.7, duty: MED },
    { role: AIN, start: '07:00', end: '15:30', brk: 30, n: 0.6, note: 'Patient special (1:1). Handover from the nurse in charge.' },
    { role: AIN, start: '21:30', end: '07:30', brk: 30, n: 0.5, note: 'Patient special (1:1) overnight.' },
  ],
  ed: [
    { role: RN, start: '07:00', end: '15:30', brk: 30, n: 1.4 },
    { role: RN, start: '13:00', end: '21:30', brk: 30, n: 1.4, note: 'Emergency experience required.' },
    { role: RN, start: '21:30', end: '07:30', brk: 30, n: 1 },
  ],
  rehab: [
    { role: RN, start: '07:00', end: '15:30', brk: 30, n: 0.8 },
    { role: RN, start: '13:00', end: '21:30', brk: 30, n: 0.7 },
    { role: EN, start: '07:00', end: '15:30', brk: 30, n: 0.8 },
    { role: EN, start: '13:00', end: '21:30', brk: 30, n: 0.5 },
    { role: AIN, start: '07:00', end: '13:30', brk: 0, n: 1 },
  ],
  dayproc: [
    { role: RN, start: '07:00', end: '15:30', brk: 30, n: 1.6, note: 'Recovery experience preferred.' },
    { role: RN, start: '10:00', end: '18:30', brk: 30, n: 0.6 },
    { role: EN, start: '07:30', end: '16:00', brk: 30, n: 0.5 },
  ],
  aged: [
    { role: PCW, start: '07:00', end: '15:00', brk: 30, n: 1.6 },
    { role: PCW, start: '15:00', end: '23:00', brk: 30, n: 1.2 },
    { role: PCW, start: '23:00', end: '07:00', brk: 30, n: 0.4 },
    { role: AIN, start: '07:00', end: '13:00', brk: 0, n: 0.5 },
    { role: AIN, start: '16:00', end: '21:00', brk: 0, n: 0.3 },
    { role: EN, start: '07:00', end: '15:00', brk: 30, n: 0.35, duty: MED },
    { role: RN, start: '07:00', end: '15:00', brk: 30, n: 0.2, note: 'RN in charge of the floor.' },
    { role: RN, start: '23:00', end: '07:00', brk: 30, n: 0.2, note: 'In charge of the facility overnight.' },
  ],
  memory: [
    { role: PCW, start: '07:00', end: '15:00', brk: 30, n: 1.3, note: 'Dementia experience preferred.', gender: true },
    { role: PCW, start: '15:00', end: '23:00', brk: 30, n: 1, note: 'Dementia experience preferred.' },
    { role: AIN, start: '07:00', end: '13:00', brk: 0, n: 0.3 },
  ],
  mh: [
    { role: RN, start: '07:00', end: '15:30', brk: 30, n: 1.2 },
    { role: RN, start: '13:00', end: '21:30', brk: 30, n: 1.1 },
    { role: RN, start: '21:30', end: '07:30', brk: 30, n: 0.8 },
    { role: EN, start: '07:00', end: '15:30', brk: 30, n: 0.4 },
  ],
  sil: [
    { role: DSW, start: '07:00', end: '15:00', brk: 30, n: 1, gender: true, duty: DRIVES },
    { role: DSW, start: '15:00', end: '23:00', brk: 30, n: 1, gender: true },
    { role: DSW, start: '23:00', end: '07:00', brk: 0, n: 0.7, note: 'Active night: two-hourly checks.' },
  ],
  community: [
    { role: DSW, start: '08:00', end: '12:00', brk: 0, n: 1.6, duty: DRIVES },
    { role: DSW, start: '13:00', end: '17:00', brk: 0, n: 1.2, duty: DRIVES },
    { role: PCW, start: '07:00', end: '11:00', brk: 0, n: 0.8 },
  ],
  warehouse: [
    { role: PICK, start: '06:00', end: '14:30', brk: 30, n: 1.8 },
    { role: PROCESS, start: '14:00', end: '22:30', brk: 30, n: 1.2 },
    { role: FORKLIFT, start: '06:00', end: '14:30', brk: 30, n: 0.6, duty: 'Drives a forklift' },
    { role: STORE, start: '06:00', end: '14:30', brk: 30, n: 0.4 },
  ],
};
/** How busy each kind of area is on Saturday and Sunday (1 = like a weekday). */
export const WEEKEND: Record<AreaKind, number> = { ward: 0.9, ed: 1, rehab: 0.8, dayproc: 0, aged: 1, memory: 1, mh: 1, sil: 1, community: 0.5, warehouse: 0.3 };

/** People by main role, the other roles some of them also work, and other roles whose shifts count towards how many there are (`covers`; numbers come from each office's demand, SUPPLY in demo-day.ts). */
export const ROLE_GROUPS: { role: string; also?: [string, number][]; covers?: string[]; male: number }[] = [
  { role: RN, also: [[EN, 0.15]], male: 0.14 },
  { role: EN, also: [[AIN, 0.35]], male: 0.15 },
  { role: AIN, also: [[PCW, 0.45]], male: 0.22 },
  { role: PCW, also: [[AIN, 0.4]], male: 0.2 },
  { role: DSW, also: [[PCW, 0.3]], male: 0.35 },
  { role: PICK, also: [[PROCESS, 0.9], [STORE, 0.3]], covers: [PROCESS], male: 0.6 },
  { role: FORKLIFT, also: [[STORE, 0.8], [PICK, 0.5]], covers: [STORE], male: 0.85 },
];

/** Invented first names and surnames (a mix, as in any Australian care workforce). */
export const FIRST_F = [
  'Olivia', 'Amelia', 'Charlotte', 'Isla', 'Mia', 'Ava', 'Grace', 'Chloe', 'Zoe', 'Matilda', 'Harper', 'Sienna', 'Ella', 'Aaliyah', 'Anjali',
  'Deepika', 'Neha', 'Ritu', 'Pooja', 'Aisha', 'Fatima', 'Leila', 'Yasmin', 'Mei', 'Xin', 'Hui', 'Thuy', 'Linh', 'Ngoc', 'Maria', 'Joy',
  'Rowena', 'Marites', 'Analyn', 'Precious', 'Chipo', 'Nomvula', 'Amara', 'Esther', 'Wanjiru', 'Sofia', 'Eleni', 'Georgia', 'Chiara', 'Giulia',
  'Hana', 'Yuki', 'Losana', 'Mele', 'Sina', 'Tegan', 'Brooke', 'Kylie', 'Leanne', 'Megan', 'Rachel', 'Hayley', 'Kirsten', 'Bronwyn', 'Joanne',
  'Nicole', 'Melissa', 'Rebecca', 'Sarah', 'Jessica', 'Lauren', 'Holly', 'Mikaela', 'Shreya', 'Ishita', 'Kavya', 'Nisha', 'Rhea', 'Tanvi',
  'Sunita', 'Bindu', 'Lakshmi', 'Sapna', 'Ama', 'Abena', 'Ruth', 'Miriam', 'Imani', 'Nadia', 'Farah', 'Huong', 'Trang', 'Jia', 'Lan',
];
export const FIRST_M = [
  'Jack', 'Liam', 'Noah', 'Oliver', 'Ethan', 'Lucas', 'Mason', 'Ryan', 'Daniel', 'Ben', 'Sam', 'Tom', 'Aaron', 'Arjun', 'Rohan', 'Vikram',
  'Nikhil', 'Amit', 'Rahul', 'Kiran', 'Sanjay', 'Tariq', 'Omar', 'Yusuf', 'Minh', 'Duc', 'Wei', 'Jun', 'Kenji', 'Paolo', 'Marco', 'Nikos',
  'Jomar', 'Rodel', 'Emmanuel', 'Kwame', 'Tendai', 'Tafadzwa', 'Samuel', 'Isaac', 'Ioane', 'Sione', 'Hamish', 'Angus', 'Declan', 'Connor',
];
export const SURNAMES = [
  'Nguyen', 'Tran', 'Le', 'Pham', 'Chen', 'Wang', 'Zhang', 'Huang', 'Lim', 'Tan', 'Wong', 'Patel', 'Shah', 'Desai', 'Iyer', 'Nair', 'Pillai',
  'Reddy', 'Rao', 'Joshi', 'Gupta', 'Verma', 'Bhatt', 'Gurung', 'Shrestha', 'Thapa', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza',
  'Villanueva', 'Ocampo', 'Okoro', 'Mensah', 'Mwangi', 'Otieno', 'Moyo', 'Dube', 'Ndlovu', 'Haile', 'Tesfaye', 'Abebe', 'Ahmed', 'Rahman',
  'Karimi', 'Nasser', 'Papadopoulos', 'Nikolaidis', 'Romano', 'Esposito', 'Bianchi', 'Kowalski', 'Novak', 'Smith', 'Jones', 'Williams',
  'Brown', 'Wilson', 'Anderson', 'Thomas', 'Martin', 'Thompson', 'Walker', 'Harris', 'Robinson', 'Kelly', 'Ryan', "O'Brien", 'Murphy',
  'Walsh', 'McDonald', 'Campbell', 'Stewart', 'Morrison', 'Hughes', 'Edwards', 'Evans', 'Turner', 'Collins', 'Bennett', 'Price', 'Cooper',
  'Mitchell', 'Fale', 'Tuilagi', 'Vaipulu', 'Kaufusi', 'Ng', 'Ho', 'Yeo', 'Park', 'Kim', 'Lee', 'Sato', 'Ito', 'Haddad', 'Farouk', 'Silva',
];

export const WORKER_NOTES = [
  'Prefers morning shifts. Has a car.',
  'Happy to travel up to an hour.',
  'Public transport only: check the site is near a station.',
  'Studying part time; free most weekends.',
  'Likes regular shifts at the same homes.',
  'Will do short-notice night shifts.',
  'Experienced in dementia care.',
  'Has worked in emergency departments.',
  'Not available school holidays.',
];

export const ORDER_NOTES = [
  'Please send someone who has worked here before.',
  'Report to the nurse in charge on arrival.',
  'Covering a staff member on leave.',
  'Extra staff for a busy theatre list.',
  'Same person for the whole block if possible.',
  'Ring the ward on arrival; the front door is locked after 8pm.',
];

export const CALL_NOTES_WORKER = [
  'Asked about travel time.',
  'Will reply by text after school pick-up.',
  'Already working that day.',
  'Happy to take it.',
  'Wants the whole block.',
  'Can only do until 13:00.',
];

/** What a person might ask for a day (in their own words; never health details). */
export const DAY_REQUEST_NOTES = ['Can only work near a station that day', 'Prefer the same site as yesterday', 'School pick-up at 15:15', 'Would like a short shift'];

/**
 * Where the invented people live, per office (distance from home, David 4 Nov): real suburb and postcode pairs from
 * the GeoNames postcode file (places, not people) near each office's sites, so the demo shows distances. Street
 * lines are made up ("12 Example St"); nobody lives at any of these.
 */
export const HOME_PLACES: Record<string, [suburb: string, postcode: string][]> = {
  mel: [['Footscray', '3011'], ['Seddon', '3011'], ['Newport', '3015'], ['Sunshine', '3020'], ['St Albans', '3021'], ['Ascot Vale', '3032'],
    ['Moonee Ponds', '3039'], ['Essendon', '3040'], ['Pascoe Vale', '3044'], ['Glenroy', '3046'], ['Brunswick West', '3055'], ['Coburg', '3058'],
    ['Fawkner', '3060'], ['Northcote', '3070'], ['Thornbury', '3071'], ['Preston', '3072'], ['Reservoir', '3073'], ['Epping', '3076'],
    ['Heidelberg West', '3081'], ['Bundoora', '3083'], ['Kew', '3101'], ['Balwyn', '3103'], ['Richmond', '3121'], ['Camberwell', '3124'],
    ['Surrey Hills', '3127'], ['Ashburton', '3147'], ['Bentleigh East', '3165'], ['Hoppers Crossing', '3029'], ['Werribee', '3030']],
  bay: [['Moorabbin', '3189'], ['Highett', '3190'], ['Cheltenham', '3192'], ['Mentone', '3194'], ['Parkdale', '3195'], ['Chelsea', '3196'],
    ['Carrum', '3197'], ['Seaford', '3198'], ['Frankston', '3199'], ['Frankston North', '3200'], ['Carrum Downs', '3201'], ['Langwarrin', '3910'],
    ['Somerville', '3912'], ['Hastings', '3915'], ['Mount Eliza', '3930'], ['Mornington', '3931'], ['Mount Martha', '3934'], ['Dromana', '3936'],
    ['Rosebud', '3939'], ['Rye', '3941'], ['Cranbourne', '3977']],
  gee: [['Lara', '3212'], ['Corio', '3214'], ['Norlane', '3214'], ['Bell Park', '3215'], ['Grovedale', '3216'], ['Highton', '3216'], ['Belmont', '3216'],
    ['Armstrong Creek', '3217'], ['Geelong West', '3218'], ['Whittington', '3219'], ['Newtown', '3220'], ['Drysdale', '3222'], ['Portarlington', '3223'],
    ['Ocean Grove', '3226'], ['Barwon Heads', '3227'], ['Torquay', '3228'], ['Jan Juc', '3228'], ['Anglesea', '3230']],
  bal: [['Melton', '3337'], ['Melton South', '3338'], ['Bacchus Marsh', '3340'], ['Darley', '3340'], ['Ballarat East', '3350'], ['Alfredton', '3350'],
    ['Mount Pleasant', '3350'], ['Wendouree', '3355'], ['Lake Gardens', '3355'], ['Sebastopol', '3356'], ['Delacombe', '3356'], ['Buninyong', '3357'],
    ['Creswick', '3363'], ['Clunes', '3370']],
  sun: [['Pelican Waters', '4551'], ['Mooloolah', '4553'], ['Palmwoods', '4555'], ['Buderim', '4556'], ['Sippy Downs', '4556'], ['Mooloolaba', '4557'],
    ['Maroochydore', '4558'], ['Woombye', '4559'], ['Bli Bli', '4560'], ['Yandina', '4561'], ['Eumundi', '4562'], ['Marcoola', '4564'],
    ['Tewantin', '4565'], ['Noosaville', '4566'], ['Sunshine Beach', '4567'], ['Alexandra Headland', '4572'], ['Coolum Beach', '4573'], ['Wurtulla', '4575']],
};

/** Invented street names for the made-up home addresses. */
export const HOME_STREETS = ['Example St', 'Sample Rd', 'Demo Ave', 'Placeholder Cres', 'Pretend Pde', 'Mockup Ct', 'Test Tce', 'Specimen Way'];
