/**
 * Industry templates per country (backlog: International). The packs in `packs.ts` are written for Australia; a
 * business in New Zealand, the USA or the UK gets its own country's version when it applies one: Australian
 * credentials (AHPRA, White Card, HLTAID first aid, high risk work licences, licence classes, state security
 * licences…) are swapped for that country's usual equivalent, or left out when there is none, and everything that
 * refers to them (role rules, duties, operator licences) follows. Credentials that aren't tied to a country (manual
 * handling, food handler training, sign-offs) stay as they are and keep their `au.` catalogue code, so they still
 * match across businesses in different countries; swapped ones get the country's own code (`nz.`, `us.`, `gb.`).
 *
 * Like the packs, these are starting points for a business to adjust, not statements of what the law requires;
 * many of these vary by state, province or employer. Worked out on read, never stored.
 */
import type { CountryCode } from '../common/countries.js';
import { catalogueCode, packById, PACKS, type Category, type IndustryPack, type PackCredential } from './packs.js';

type Swap = Omit<PackCredential, 'code'> | null;
interface CountryVersion {
  /** Australian credential name → the country's credential (null = left out). Several may swap to one. */
  credentials: Record<string, Swap>;
  /** Role names that carry an Australian licence class. */
  roles?: Record<string, string>;
  /** Pack descriptions that name Australian credentials. */
  descriptions?: Record<string, string>;
}
export type OtherCountry = Exclude<CountryCode, 'AU'>;

const s = (name: string, category: Category, number: boolean, expiry: boolean, method: string): Swap => ({ name, category, number, expiry, method });

// Plant and high risk work tickets: the same plain names in each country, checked the way that country does it.
const ticket = (what: string) => s(`${what} Operator Certificate`, 'licence', true, true, "Sight the certificate; check what your country or state requires for this machine");
const plant = (country: string) => ({
  'High Risk Work Licence: Forklift (LF)': ticket('Forklift'),
  'High Risk Work Licence: Order Picker (LO)': ticket('Order Picker'),
  'High Risk Work Licence: Dogging (DG)': s('Slinging and Signalling Certificate', 'licence', true, true, 'Sight the certificate'),
  'High Risk Work Licence: Basic Rigging (RB)': s('Rigging Certificate', 'licence', true, true, 'Sight the certificate'),
  'High Risk Work Licence: Basic Scaffolding (SB)': s('Scaffolding Certificate', 'licence', true, true, `Sight the certificate${country}`),
  'High Risk Work Licence: Boom-type EWP 11 m or more (WP)': ticket('Boom Lift (EWP)'),
  'High Risk Work Licence: Non-slewing Mobile Crane (CN)': ticket('Mobile Crane'),
  'Plant Ticket: Excavator (VOC)': ticket('Excavator'),
  'Plant Ticket: Skid Steer Loader (VOC)': ticket('Skid Steer Loader'),
});
// Trades and hospitality qualifications named for Australia's certificates.
const quals = {
  'Certificate III in Commercial Cookery': s('Cookery Qualification', 'training', true, false, 'Sight qualification'),
  'Certificate IV in Kitchen Management': s('Kitchen Management Qualification', 'training', true, false, 'Sight qualification'),
};

export const COUNTRY_VERSIONS: Record<OtherCountry, CountryVersion> = {
  NZ: {
    credentials: {
      'AHPRA Registration': s('Annual Practising Certificate', 'registration', true, true, "Check the responsible authority's public register (e.g. Nursing Council of New Zealand; renews each year)"),
      'National Police Check': s('Police Vetting', 'check', false, true, 'Sight the NZ Police vetting result; set the renewal date by your policy'),
      'NDIS Worker Screening Check': null,
      'Working with Children Check': s("Children's Worker Safety Check", 'check', false, true, "Complete the Children's Act safety check (re-checked every 3 years)"),
      'First Aid (HLTAID011)': s('First Aid Certificate', 'training', true, true, 'Sight certificate (commonly renewed every 2 years)'),
      'CPR (HLTAID009)': s('CPR Certificate', 'training', true, true, 'Sight certificate (commonly renewed every year)'),
      'Certificate III in Individual Support': s('NZ Certificate in Health and Wellbeing (Level 3)', 'training', true, false, 'Sight qualification'),
      'Driver Licence (C, car)': s('Driver Licence (Class 1, car)', 'licence', true, true, 'Sight the licence'),
      'Driver Licence (MR, medium rigid)': s('Driver Licence (Class 2, medium rigid)', 'licence', true, true, 'Sight the licence'),
      'Driver Licence (HR, heavy rigid)': s('Driver Licence (Class 4, heavy rigid)', 'licence', true, true, 'Sight the licence'),
      'Food Safety Supervisor Certificate': s('Food Safety Supervisor Training', 'training', true, true, 'Sight certificate; check what your food control plan asks for'),
      'Responsible Service of Alcohol (RSA)': s('Responsible Alcohol Service Training', 'training', true, true, "Sight certificate; duty managers also need a manager's certificate"),
      'White Card (General Construction Induction)': s('Site Safe Passport', 'training', true, true, 'Sight the passport (commonly renewed every 2 years)'),
      'Chain of Responsibility Awareness': null,
      'Traffic Controller Accreditation': s('Temporary Traffic Management Worker', 'licence', true, true, 'Sight the certificate and check current NZ traffic management requirements'),
      'Traffic Management Implementer Accreditation': s('Site Traffic Management Supervisor (STMS)', 'licence', true, true, 'Sight the certificate and check current NZ traffic management requirements'),
      'Traffic Management Design / Planning': s('Traffic Management Planning', 'training', true, true, 'Sight the certificate'),
      'Security Licence: Security Guard': s('Certificate of Approval: Security Guard', 'licence', true, true, 'Check the PSPLA public register'),
      'Security Licence: Crowd Controller': s('Certificate of Approval: Crowd Controller', 'licence', true, true, 'Check the PSPLA public register'),
      ...quals,
      ...plant(''),
    },
    roles: { 'Truck Driver (MR)': 'Truck Driver (Class 2)', 'Truck Driver (HR)': 'Truck Driver (Class 4)' },
    descriptions: {
      healthcare: 'Hospitals, aged care, disability support and nursing: practising certificates, police vetting, vaccinations and clinical training.',
      hospitality: 'Cafés, restaurants, bars and catering: food safety, responsible alcohol service, barista and kitchen competencies.',
      construction: 'Builders, civil and earthworks crews: Site Safe, plant operator certificates, site inductions, plant and PPE.',
      'labour-hire': 'Warehouses, distribution centres, manufacturing and general labour: forklift certificates, police vetting, inductions, trucks and PPE.',
      'traffic-management': 'Traffic control crews: temporary traffic management qualifications, Site Safe, TMA trucks, arrow boards and signage.',
      cleaning: "Commercial cleaning and facilities services: police vetting, children's worker checks, chemical training, machines and supplies.",
      security: 'Guarding, patrols and venue crowd control: certificates of approval, first aid and responsible alcohol service.',
    },
  },
  US: {
    credentials: {
      'AHPRA Registration': s('Nursing License', 'registration', true, true, 'Check the state board of nursing (e.g. through Nursys)'),
      'National Police Check': s('Background Check', 'check', false, true, 'Sight the result; set the renewal date by your policy and state rules'),
      'NDIS Worker Screening Check': null,
      'Working with Children Check': s('Background Check', 'check', false, true, 'Sight the result; set the renewal date by your policy and state rules'),
      'First Aid (HLTAID011)': s('First Aid Certification', 'training', true, true, 'Sight the card (commonly renewed every 2 years)'),
      'CPR (HLTAID009)': s('CPR / BLS Certification', 'training', true, true, 'Sight the card (commonly renewed every 2 years)'),
      'Certificate III in Individual Support': s('Certified Nursing Assistant (CNA)', 'registration', true, true, "Check the state's nurse aide registry"),
      'Driver Licence (C, car)': s("Driver's License", 'licence', true, true, 'Sight the license'),
      'Driver Licence (MR, medium rigid)': s("Commercial Driver's License (Class B)", 'licence', true, true, 'Sight the license and medical card'),
      'Driver Licence (HR, heavy rigid)': s("Commercial Driver's License (Class B)", 'licence', true, true, 'Sight the license and medical card'),
      'Food Safety Supervisor Certificate': s('Certified Food Protection Manager', 'training', true, true, 'Sight certificate (commonly valid for 5 years)'),
      'Food Handler Training': s('Food Handler Card', 'training', true, true, 'Sight the card; check your state and county rules'),
      'Responsible Service of Alcohol (RSA)': s('Alcohol Server Certification', 'training', true, true, 'Sight certificate from a state-approved course'),
      'White Card (General Construction Induction)': s('OSHA 10-Hour Construction', 'training', true, false, 'Sight the Department of Labor card'),
      'Chain of Responsibility Awareness': null,
      'Traffic Controller Accreditation': s('Flagger Certification', 'licence', true, true, 'Sight the card (ATSSA or state DOT)'),
      'Traffic Management Implementer Accreditation': s('Traffic Control Technician', 'licence', true, true, 'Sight the card (ATSSA or state DOT)'),
      'Traffic Management Design / Planning': s('Traffic Control Supervisor', 'licence', true, true, 'Sight the card (ATSSA or state DOT)'),
      'Security Licence: Security Guard': s('Security Guard License', 'licence', true, true, "Check the state's licensing register"),
      'Security Licence: Crowd Controller': s('Security Guard License', 'licence', true, true, "Check the state's licensing register"),
      ...quals,
      ...plant(' (OSHA rules apply)'),
    },
    roles: { 'Truck Driver (MR)': 'Truck Driver (medium)', 'Truck Driver (HR)': 'Truck Driver (CDL B)' },
    descriptions: {
      healthcare: 'Hospitals, aged care, disability support and nursing: licenses, background checks, vaccinations and clinical training.',
      hospitality: 'Cafés, restaurants, bars and catering: food safety, alcohol server certification, barista and kitchen competencies.',
      construction: 'Builders, civil and earthworks crews: OSHA 10, plant operator certificates, site inductions, plant and PPE.',
      'labour-hire': 'Warehouses, distribution centres, manufacturing and general labour: forklift certificates, background checks, inductions, trucks and PPE.',
      'traffic-management': 'Traffic control crews: flagger and traffic control certifications, OSHA 10, TMA trucks, arrow boards and signage.',
      cleaning: 'Commercial cleaning and facilities services: background checks, chemical training, machines and supplies.',
      security: 'Guarding, patrols and venue crowd control: state guard licenses, first aid and alcohol server certification.',
    },
  },
  GB: {
    credentials: {
      'AHPRA Registration': s('NMC Registration', 'registration', true, true, 'Check the NMC register (renews each year)'),
      'National Police Check': s('DBS Check', 'check', true, true, 'Check the certificate or the DBS Update Service'),
      'NDIS Worker Screening Check': null,
      'Working with Children Check': s('Enhanced DBS Check (children)', 'check', true, true, "Check the certificate (with the children's barred list) or the DBS Update Service"),
      'First Aid (HLTAID011)': s('First Aid at Work', 'training', true, true, 'Sight certificate (valid for 3 years)'),
      'CPR (HLTAID009)': s('CPR / Basic Life Support', 'training', true, true, 'Sight certificate (commonly renewed every year)'),
      'Certificate III in Individual Support': s('Care Certificate', 'training', false, false, 'Sight the Care Certificate'),
      'Driver Licence (C, car)': s('Driving Licence (Category B, car)', 'licence', true, true, 'Check the licence with the DVLA'),
      'Driver Licence (MR, medium rigid)': s('Driving Licence (Category C1)', 'licence', true, true, 'Check the licence with the DVLA; Driver CPC if driving professionally'),
      'Driver Licence (HR, heavy rigid)': s('Driving Licence (Category C)', 'licence', true, true, 'Check the licence with the DVLA; Driver CPC if driving professionally'),
      'Food Safety Supervisor Certificate': s('Food Safety Level 3 (Supervising)', 'training', true, true, 'Sight certificate; set the refresher date by your policy'),
      'Food Handler Training': s('Food Hygiene Level 2', 'training', true, true, 'Sight certificate; set the refresher date by your policy'),
      'Responsible Service of Alcohol (RSA)': s('Responsible Alcohol Service Training', 'training', false, true, 'Training record; sales need authorising by a personal licence holder'),
      'White Card (General Construction Induction)': s('CSCS Card', 'licence', true, true, 'Check the card on the CSCS app or website'),
      'Chain of Responsibility Awareness': null,
      'Traffic Controller Accreditation': s('Traffic Management Operative (NHSS 12)', 'licence', true, true, 'Check the Lantra card'),
      'Traffic Management Implementer Accreditation': s('Traffic Management Supervisor (NHSS 12)', 'licence', true, true, 'Check the Lantra card'),
      'Traffic Management Design / Planning': s('Traffic Management Design', 'training', true, true, 'Sight certificate'),
      'Security Licence: Security Guard': s('SIA Licence: Security Guarding', 'licence', true, true, 'Check the SIA register of licence holders'),
      'Security Licence: Crowd Controller': s('SIA Licence: Door Supervision', 'licence', true, true, 'Check the SIA register of licence holders'),
      ...quals,
      ...plant(' (CPCS, NPORS or equivalent)'),
    },
    roles: { 'Truck Driver (MR)': 'Truck Driver (C1)', 'Truck Driver (HR)': 'Truck Driver (C)' },
    descriptions: {
      healthcare: 'Hospitals, care homes, disability support and nursing: NMC registration, DBS checks, vaccinations and clinical training.',
      hospitality: 'Cafés, restaurants, bars and catering: food hygiene, responsible alcohol service, barista and kitchen competencies.',
      construction: 'Builders, civil and earthworks crews: CSCS cards, plant operator certificates, site inductions, plant and PPE.',
      'labour-hire': 'Warehouses, distribution centres, manufacturing and general labour: forklift certificates, DBS checks, inductions, trucks and PPE.',
      'traffic-management': 'Traffic control crews: NHSS 12 traffic management cards, CSCS, TMA trucks, arrow boards and signage.',
      cleaning: 'Commercial cleaning and facilities services: DBS checks, chemical training, machines and supplies.',
      security: 'Guarding, patrols and venue door supervision: SIA licences, first aid and responsible alcohol service.',
    },
  },
};

const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** A pack as a business in this country should get it. Australia (and anything unknown) gets the pack as written. */
export function packFor(pack: IndustryPack, country: CountryCode | string | null | undefined): IndustryPack {
  const v = country && country !== 'AU' ? COUNTRY_VERSIONS[country as OtherCountry] : undefined;
  if (!v) return pack;
  const swapped = (name: string): string | null => {
    const x = v.credentials[name];
    return x === undefined ? name : x?.name ?? null;
  };
  const credentials: PackCredential[] = [];
  for (const cr of pack.credentials) {
    const x = v.credentials[cr.name];
    if (x === null) continue;
    const next = x === undefined ? cr : { ...x, code: catalogueCode(x.name, country as OtherCountry) };
    if (!credentials.some(c => c.name === next.name)) credentials.push(next);
  }
  // Lists of credential names: swapped, left-out ones dropped, merged ones once; anything already needed at a stronger
  // level isn't repeated at a weaker one.
  const levels = <R extends { must?: string[]; should?: string[]; optional?: string[] }>(r: R): R => {
    const map = (xs?: string[]) => uniq((xs ?? []).map(swapped).filter((n): n is string => !!n));
    const must = map(r.must);
    const should = map(r.should).filter(n => !must.includes(n));
    const optional = map(r.optional).filter(n => !must.includes(n) && !should.includes(n));
    const out = { ...r } as R;
    delete out.must; delete out.should; delete out.optional;
    if (r.must || must.length) out.must = must;
    if (r.should || should.length) out.should = should;
    if (r.optional || optional.length) out.optional = optional;
    return out;
  };
  return {
    ...pack,
    description: v.descriptions?.[pack.id] ?? pack.description,
    credentials,
    roles: pack.roles.map(r => ({ ...levels(r), name: v.roles?.[r.name] ?? r.name })),
    duties: pack.duties.map(levels),
    equipmentTypes: pack.equipmentTypes.map(e => {
      if (!e.operatorCredential) return e;
      const op = swapped(e.operatorCredential);
      const out = { ...e };
      if (op) out.operatorCredential = op; else delete out.operatorCredential;
      return out;
    }),
  };
}

/** Every pack in this country's version. */
export const packsFor = (country: CountryCode | string | null | undefined) => PACKS.map(p => packFor(p, country));
export const packByIdFor = (id: string, country: CountryCode | string | null | undefined) => {
  const p = packById(id);
  return p && packFor(p, country);
};
