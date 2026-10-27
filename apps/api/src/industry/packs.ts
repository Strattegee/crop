/**
 * Industry templates ("packs"). Applying one adds starter roles, a credential library with role requirements,
 * shift codes, equipment types and an item catalogue. They are starting points for a business to adjust,
 * not statements of what the law requires; licence names and renewal periods vary by state.
 * Applying only ever adds what's missing (matched by name or code); nothing the business changed is overwritten.
 */
export type Category = 'registration' | 'check' | 'training' | 'vaccination' | 'licence';
export type ItemCategory = 'ppe' | 'fuel' | 'sundries' | 'tools' | 'other';

export interface PackCredential { name: string; category: Category; number: boolean; expiry: boolean; method: string }
export interface PackRole { name: string; area: string; must?: string[]; should?: string[] }
export interface PackShiftCode { code: string; letter?: string; name: string; start: string; end: string; breakMinutes: number }
export interface PackEquipmentType { name: string; operatorCredential?: string; note?: string }
/** A shift duty (migration 0029): something a shift may involve, with the credentials it needs (must = blocks, should = warning). */
export interface PackDuty { name: string; description: string; must?: string[]; should?: string[] }
export interface PackItem { name: string; category: ItemCategory; unit: string; costCents: number; reorderLevel?: number }
export interface IndustryPack {
  id: string; name: string; description: string; areas: string[];
  credentials: PackCredential[]; roles: PackRole[]; shiftCodes: PackShiftCode[]; equipmentTypes: PackEquipmentType[]; items: PackItem[];
  duties: PackDuty[];
}

const c = (name: string, category: Category, number: boolean, expiry: boolean, method: string): PackCredential => ({ name, category, number, expiry, method });

// Shared credentials, so a business with several industries ends up with one of each.
const FIRST_AID = c('First Aid (HLTAID011)', 'training', true, true, 'Sight statement of attainment (commonly renewed every 3 years)');
const CPR = c('CPR (HLTAID009)', 'training', true, true, 'Sight statement of attainment (commonly renewed every year)');
const POLICE = c('National Police Check', 'check', true, true, 'Sight the certificate; set the renewal date by your policy');
const WWCC = c('Working with Children Check', 'check', true, true, 'Check the state register');
const MANUAL = c('Manual Handling Training', 'training', false, true, 'Training record');
const DRIVER_C = c('Driver Licence (C, car)', 'licence', true, true, 'Sight the licence');
const DRIVER_MR = c('Driver Licence (MR, medium rigid)', 'licence', true, true, 'Sight the licence');
const DRIVER_HR = c('Driver Licence (HR, heavy rigid)', 'licence', true, true, 'Sight the licence');
const WHITE_CARD = c('White Card (General Construction Induction)', 'training', true, false, 'Sight the card');
const SITE_INDUCTION = c('Site Induction', 'training', false, true, 'Record per site or client; set the refresher date');
const FORKLIFT = c('High Risk Work Licence: Forklift (LF)', 'licence', true, true, 'Check the licence (renewed every 5 years)');
const CHEMICAL = c('Chemical Handling (SDS) Training', 'training', false, false, 'Training record');
const HEIGHTS = c('Working at Heights', 'training', true, true, 'Sight statement of attainment');
const RSA = c('Responsible Service of Alcohol (RSA)', 'licence', true, true, 'Check the state RSA record (Victoria: refresher every 3 years)');
const FOOD_HANDLER = c('Food Handler Training', 'training', false, false, 'Sight certificate');
const FOOD_SUPERVISOR = c('Food Safety Supervisor Certificate', 'training', true, true, 'Sight certificate (obtained within the last 5 years)');
const ALLERGEN = c('Allergen Awareness Training', 'training', false, true, 'Sight certificate');

export const PACKS: IndustryPack[] = [
  {
    id: 'healthcare',
    name: 'Healthcare and aged care',
    description: 'Hospitals, aged care, disability support and nursing: AHPRA registration, screening checks, vaccinations and clinical training.',
    areas: ['Ward', 'Residential care', 'Community'],
    credentials: [
      c('AHPRA Registration', 'registration', true, true, 'Check the AHPRA public register (renews each year)'),
      POLICE, c('NDIS Worker Screening Check', 'check', true, true, 'Check the NDIS worker screening database'), WWCC,
      FIRST_AID, CPR, MANUAL, c('Infection Prevention and Control Training', 'training', false, true, 'Training record'),
      c('Medication Administration Competency', 'training', false, true, 'Competency sign-off'),
      c('Certificate III in Individual Support', 'training', true, false, 'Sight qualification'),
      c('Influenza Vaccination', 'vaccination', false, true, 'Sight vaccination evidence (yearly)'),
      DRIVER_C,
    ],
    roles: [
      { name: 'Nurse Unit Manager', area: 'Ward', must: ['AHPRA Registration', 'National Police Check'], should: ['First Aid (HLTAID011)'] },
      { name: 'Registered Nurse', area: 'Ward', must: ['AHPRA Registration', 'National Police Check', 'CPR (HLTAID009)'], should: ['Influenza Vaccination', 'Infection Prevention and Control Training'] },
      { name: 'Enrolled Nurse', area: 'Ward', must: ['AHPRA Registration', 'National Police Check', 'CPR (HLTAID009)'], should: ['Influenza Vaccination', 'Medication Administration Competency'] },
      { name: 'Assistant in Nursing', area: 'Ward', must: ['National Police Check', 'CPR (HLTAID009)', 'Manual Handling Training'], should: ['Influenza Vaccination'] },
      { name: 'Personal Care Worker', area: 'Residential care', must: ['National Police Check', 'Certificate III in Individual Support', 'Manual Handling Training'], should: ['First Aid (HLTAID011)', 'Influenza Vaccination'] },
      { name: 'Disability Support Worker', area: 'Community', must: ['NDIS Worker Screening Check', 'First Aid (HLTAID011)', 'Manual Handling Training'], should: ['Driver Licence (C, car)', 'Working with Children Check'] },
      { name: 'Ward Clerk', area: 'Ward', must: ['National Police Check'] },
    ],
    shiftCodes: [
      { code: 'AM', letter: 'AM', name: 'Morning', start: '07:00', end: '15:30', breakMinutes: 30 },
      { code: 'PM', letter: 'PM', name: 'Afternoon', start: '13:30', end: '22:00', breakMinutes: 30 },
      { code: 'ND', letter: 'ND', name: 'Night duty', start: '21:30', end: '07:30', breakMinutes: 30 },
    ],
    equipmentTypes: [{ name: 'Pool car', operatorCredential: 'Driver Licence (C, car)' }, { name: 'Patient lifter', note: 'Track service and test-and-tag dates' }],
    items: [
      { name: 'Nitrile gloves (box of 100)', category: 'ppe', unit: 'box', costCents: 1100, reorderLevel: 20 },
      { name: 'Surgical masks (box of 50)', category: 'ppe', unit: 'box', costCents: 900, reorderLevel: 10 },
      { name: 'P2/N95 respirators (box of 20)', category: 'ppe', unit: 'box', costCents: 3500, reorderLevel: 5 },
      { name: 'Hand sanitiser 500 ml', category: 'sundries', unit: 'bottle', costCents: 650, reorderLevel: 12 },
      { name: 'Disposable aprons (roll)', category: 'ppe', unit: 'roll', costCents: 1800, reorderLevel: 5 },
    ],
    duties: [
      { name: 'Drives clients', description: 'Driving clients or patients in a car', must: ['Driver Licence (C, car)'] },
      { name: 'Works with children', description: 'Paediatric ward, school or family visits', must: ['Working with Children Check'] },
      { name: 'Gives medication', description: 'Administers or assists with medication on this shift', must: ['Medication Administration Competency'] },
      { name: 'First aid officer', description: 'The nominated first aider on this shift', must: ['First Aid (HLTAID011)'] },
    ],
  },
  {
    id: 'hospitality',
    name: 'Hospitality',
    description: 'Cafés, restaurants, bars and catering: food safety, RSA, barista and kitchen competencies.',
    areas: ['Front of House', 'Coffee Bar', 'Kitchen', 'Back Office'],
    credentials: [
      FOOD_HANDLER, FOOD_SUPERVISOR, ALLERGEN, RSA, FIRST_AID, CPR, MANUAL, CHEMICAL,
      c('Espresso Machine Competency', 'training', false, false, 'Sign-off by Head Barista'),
      c('Kitchen Equipment Sign-off', 'training', false, false, 'Sign-off by Head Chef'),
      c('Certificate III in Commercial Cookery', 'training', true, false, 'Sight qualification'),
      c('Certificate IV in Kitchen Management', 'training', true, false, 'Sight qualification'),
      c('Apprenticeship Enrolment', 'registration', true, true, 'Check the training contract'),
      DRIVER_C,
    ],
    roles: [
      { name: 'General Manager', area: 'Back Office', must: ['Food Safety Supervisor Certificate', 'Responsible Service of Alcohol (RSA)'], should: ['First Aid (HLTAID011)'] },
      { name: 'Duty Manager', area: 'Front of House', must: ['Food Handler Training', 'Responsible Service of Alcohol (RSA)', 'First Aid (HLTAID011)'], should: ['CPR (HLTAID009)', 'Food Safety Supervisor Certificate'] },
      { name: 'FOH Supervisor', area: 'Front of House', must: ['Food Handler Training', 'Responsible Service of Alcohol (RSA)'], should: ['First Aid (HLTAID011)'] },
      { name: 'Head Barista', area: 'Coffee Bar', must: ['Food Handler Training', 'Espresso Machine Competency', 'Allergen Awareness Training'] },
      { name: 'Barista', area: 'Coffee Bar', must: ['Food Handler Training', 'Espresso Machine Competency', 'Allergen Awareness Training'] },
      { name: 'Waitstaff', area: 'Front of House', must: ['Food Handler Training', 'Allergen Awareness Training'], should: ['Responsible Service of Alcohol (RSA)'] },
      { name: 'Bartender', area: 'Front of House', must: ['Responsible Service of Alcohol (RSA)', 'Food Handler Training'] },
      { name: 'Food Runner', area: 'Front of House', must: ['Food Handler Training', 'Allergen Awareness Training', 'Manual Handling Training'] },
      { name: 'Head Chef', area: 'Kitchen', must: ['Certificate III in Commercial Cookery', 'Food Safety Supervisor Certificate', 'Allergen Awareness Training'], should: ['Certificate IV in Kitchen Management'] },
      { name: 'Sous Chef', area: 'Kitchen', must: ['Certificate III in Commercial Cookery', 'Food Handler Training'], should: ['Allergen Awareness Training', 'Food Safety Supervisor Certificate'] },
      { name: 'Chef de Partie', area: 'Kitchen', must: ['Certificate III in Commercial Cookery', 'Food Handler Training', 'Allergen Awareness Training', 'Kitchen Equipment Sign-off'] },
      { name: 'Cook', area: 'Kitchen', must: ['Food Handler Training', 'Allergen Awareness Training', 'Kitchen Equipment Sign-off'] },
      { name: 'Apprentice Chef', area: 'Kitchen', must: ['Apprenticeship Enrolment', 'Food Handler Training', 'Kitchen Equipment Sign-off'] },
      { name: 'Kitchen Hand', area: 'Kitchen', must: ['Food Handler Training', 'Chemical Handling (SDS) Training', 'Manual Handling Training'], should: ['Kitchen Equipment Sign-off'] },
      { name: 'Stock Coordinator', area: 'Back Office', must: ['Manual Handling Training'], should: ['Food Handler Training'] },
      { name: 'Administration Officer', area: 'Back Office' },
    ],
    shiftCodes: [
      { code: 'EARLY', letter: 'E', name: 'Breakfast', start: '06:30', end: '14:30', breakMinutes: 30 },
      { code: 'MID', letter: 'M', name: 'Lunch', start: '10:00', end: '16:00', breakMinutes: 30 },
      { code: 'CLOSE', letter: 'C', name: 'Dinner', start: '15:30', end: '22:30', breakMinutes: 30 },
      { code: 'K-AM', letter: 'KE', name: 'Kitchen early', start: '06:00', end: '14:00', breakMinutes: 30 },
      { code: 'K-PM', letter: 'KL', name: 'Kitchen late', start: '14:00', end: '22:00', breakMinutes: 30 },
    ],
    equipmentTypes: [
      { name: 'Catering van', operatorCredential: 'Driver Licence (C, car)' },
      { name: 'Espresso machine', note: 'Track service and test-and-tag dates' },
      { name: 'Combi oven', note: 'Track service dates' },
    ],
    items: [
      { name: 'Disposable gloves (box of 100)', category: 'ppe', unit: 'box', costCents: 1200, reorderLevel: 10 },
      { name: 'Apron', category: 'ppe', unit: 'each', costCents: 1500, reorderLevel: 5 },
      { name: 'Milk', category: 'sundries', unit: 'litre', costCents: 180, reorderLevel: 60 },
      { name: 'Coffee beans', category: 'sundries', unit: 'kg', costCents: 3800, reorderLevel: 10 },
      { name: 'Takeaway cups (sleeve of 50)', category: 'sundries', unit: 'sleeve', costCents: 900, reorderLevel: 20 },
      { name: 'Sanitiser (5 L)', category: 'sundries', unit: 'drum', costCents: 2800, reorderLevel: 2 },
    ],
    duties: [
      { name: 'Serves alcohol', description: 'Pours or serves alcohol on this shift', must: ['Responsible Service of Alcohol (RSA)'] },
      { name: 'Food safety supervisor', description: 'The food safety supervisor on site for this shift', must: ['Food Safety Supervisor Certificate'] },
      { name: 'Handles food', description: 'Prepares or serves unpackaged food', must: ['Food Handler Training'], should: ['Allergen Awareness Training'] },
      { name: 'First aid officer', description: 'The nominated first aider on this shift', must: ['First Aid (HLTAID011)'] },
    ],
  },
  {
    id: 'construction',
    name: 'Construction',
    description: 'Builders, civil and earthworks crews: White Card, high risk work licences, plant tickets, site inductions, plant and PPE.',
    areas: ['Site', 'Yard', 'Office'],
    credentials: [
      WHITE_CARD, SITE_INDUCTION, FIRST_AID, HEIGHTS,
      c('Confined Space Entry', 'training', true, true, 'Sight statement of attainment'),
      c('Asbestos Awareness', 'training', false, true, 'Training record'),
      FORKLIFT,
      c('High Risk Work Licence: Dogging (DG)', 'licence', true, true, 'Check the licence (renewed every 5 years)'),
      c('High Risk Work Licence: Basic Rigging (RB)', 'licence', true, true, 'Check the licence (renewed every 5 years)'),
      c('High Risk Work Licence: Basic Scaffolding (SB)', 'licence', true, true, 'Check the licence (renewed every 5 years)'),
      c('High Risk Work Licence: Boom-type EWP 11 m or more (WP)', 'licence', true, true, 'Check the licence (renewed every 5 years)'),
      c('High Risk Work Licence: Non-slewing Mobile Crane (CN)', 'licence', true, true, 'Check the licence (renewed every 5 years)'),
      c('Plant Ticket: Excavator (VOC)', 'training', true, true, 'Sight statement of attainment or verification of competency'),
      c('Plant Ticket: Skid Steer Loader (VOC)', 'training', true, true, 'Sight statement of attainment or verification of competency'),
      c('EWP Operator Training (under 11 m)', 'training', true, true, 'Sight statement of attainment'),
      DRIVER_C, DRIVER_HR,
    ],
    roles: [
      { name: 'Site Supervisor', area: 'Site', must: ['White Card (General Construction Induction)', 'First Aid (HLTAID011)'], should: ['Working at Heights'] },
      { name: 'Leading Hand', area: 'Site', must: ['White Card (General Construction Induction)'], should: ['First Aid (HLTAID011)'] },
      { name: 'Carpenter', area: 'Site', must: ['White Card (General Construction Induction)'], should: ['Working at Heights'] },
      { name: 'Labourer', area: 'Site', must: ['White Card (General Construction Induction)'], should: ['Site Induction', 'Asbestos Awareness'] },
      { name: 'Excavator Operator', area: 'Site', must: ['White Card (General Construction Induction)', 'Plant Ticket: Excavator (VOC)'] },
      { name: 'Skid Steer Operator', area: 'Site', must: ['White Card (General Construction Induction)', 'Plant Ticket: Skid Steer Loader (VOC)'] },
      { name: 'Crane Operator', area: 'Site', must: ['White Card (General Construction Induction)', 'High Risk Work Licence: Non-slewing Mobile Crane (CN)'] },
      { name: 'Dogman', area: 'Site', must: ['White Card (General Construction Induction)', 'High Risk Work Licence: Dogging (DG)'] },
      { name: 'Rigger', area: 'Site', must: ['White Card (General Construction Induction)', 'High Risk Work Licence: Basic Rigging (RB)', 'Working at Heights'] },
      { name: 'Scaffolder', area: 'Site', must: ['White Card (General Construction Induction)', 'High Risk Work Licence: Basic Scaffolding (SB)', 'Working at Heights'] },
      { name: 'Truck Driver (HR)', area: 'Yard', must: ['Driver Licence (HR, heavy rigid)', 'White Card (General Construction Induction)'] },
      { name: 'Yard Hand', area: 'Yard', must: ['White Card (General Construction Induction)'], should: ['High Risk Work Licence: Forklift (LF)'] },
    ],
    shiftCodes: [
      { code: 'DAY', letter: 'D', name: 'Day', start: '07:00', end: '15:30', breakMinutes: 30 },
      { code: 'EARLY', letter: 'E', name: 'Early start', start: '06:00', end: '14:30', breakMinutes: 30 },
      { code: 'NIGHT', letter: 'N', name: 'Night works', start: '19:00', end: '05:00', breakMinutes: 30 },
    ],
    equipmentTypes: [
      { name: 'Excavator (5 t)', operatorCredential: 'Plant Ticket: Excavator (VOC)' },
      { name: 'Excavator (20 t)', operatorCredential: 'Plant Ticket: Excavator (VOC)' },
      { name: 'Skid steer loader', operatorCredential: 'Plant Ticket: Skid Steer Loader (VOC)' },
      { name: 'Tipper truck', operatorCredential: 'Driver Licence (HR, heavy rigid)' },
      { name: 'Franna crane', operatorCredential: 'High Risk Work Licence: Non-slewing Mobile Crane (CN)' },
      { name: 'Boom lift (11 m or more)', operatorCredential: 'High Risk Work Licence: Boom-type EWP 11 m or more (WP)' },
      { name: 'Scissor lift', operatorCredential: 'EWP Operator Training (under 11 m)' },
      { name: 'Forklift', operatorCredential: 'High Risk Work Licence: Forklift (LF)' },
      { name: 'Site ute', operatorCredential: 'Driver Licence (C, car)' },
      { name: 'Generator', note: 'Track service and test-and-tag dates' },
      { name: 'Lighting tower', note: 'Track service dates' },
    ],
    items: [
      { name: 'Hard hat', category: 'ppe', unit: 'each', costCents: 2500, reorderLevel: 5 },
      { name: 'Hi-vis vest', category: 'ppe', unit: 'each', costCents: 1200, reorderLevel: 10 },
      { name: 'Safety glasses', category: 'ppe', unit: 'each', costCents: 600, reorderLevel: 20 },
      { name: 'Ear plugs (box of 200)', category: 'ppe', unit: 'box', costCents: 4500, reorderLevel: 2 },
      { name: 'Work gloves (pair)', category: 'ppe', unit: 'pair', costCents: 800, reorderLevel: 20 },
      { name: 'Fall-arrest harness', category: 'ppe', unit: 'each', costCents: 22000, reorderLevel: 2 },
      { name: 'Diesel', category: 'fuel', unit: 'litre', costCents: 200 },
      { name: 'Marking paint (can)', category: 'sundries', unit: 'can', costCents: 900, reorderLevel: 12 },
      { name: 'Star pickets', category: 'sundries', unit: 'each', costCents: 450, reorderLevel: 50 },
      { name: 'Silt fence (roll)', category: 'sundries', unit: 'roll', costCents: 6500, reorderLevel: 4 },
    ],
    duties: [
      { name: 'Works at heights', description: 'Work at height on this shift (roofs, scaffolds, ladders)', must: ['Working at Heights'] },
      { name: 'Confined space work', description: 'Enters a confined space on this shift', must: ['Confined Space Entry'] },
      { name: 'Asbestos area', description: 'Works where asbestos may be present', must: ['Asbestos Awareness'] },
      { name: 'First aid officer', description: 'The nominated first aider on this shift', must: ['First Aid (HLTAID011)'] },
    ],
  },
  {
    id: 'labour-hire',
    name: 'Labour hire, warehousing and logistics',
    description: 'Warehouses, distribution centres, manufacturing and general labour: forklift licences, police checks, inductions, trucks and PPE.',
    areas: ['Warehouse', 'Dispatch', 'Production line', 'Yard'],
    credentials: [
      FORKLIFT,
      c('High Risk Work Licence: Order Picker (LO)', 'licence', true, true, 'Check the licence (renewed every 5 years)'),
      POLICE, SITE_INDUCTION, MANUAL, FIRST_AID, WHITE_CARD,
      c('Reach Truck Training', 'training', true, true, 'Sight statement of attainment or verification of competency'),
      c('Chain of Responsibility Awareness', 'training', false, true, 'Training record'),
      DRIVER_C, DRIVER_MR, DRIVER_HR,
    ],
    roles: [
      { name: 'Warehouse Supervisor', area: 'Warehouse', must: ['Site Induction'], should: ['First Aid (HLTAID011)', 'High Risk Work Licence: Forklift (LF)'] },
      { name: 'Storeperson', area: 'Warehouse', must: ['Site Induction', 'Manual Handling Training'], should: ['National Police Check'] },
      { name: 'Pick Packer', area: 'Warehouse', must: ['Site Induction', 'Manual Handling Training'] },
      { name: 'Forklift Driver', area: 'Warehouse', must: ['High Risk Work Licence: Forklift (LF)', 'Site Induction'] },
      { name: 'Reach Truck Operator', area: 'Warehouse', must: ['High Risk Work Licence: Forklift (LF)', 'Reach Truck Training', 'Site Induction'] },
      { name: 'Order Picker Operator', area: 'Warehouse', must: ['High Risk Work Licence: Order Picker (LO)', 'Site Induction'] },
      { name: 'Process Worker', area: 'Production line', must: ['Site Induction', 'Manual Handling Training'] },
      { name: 'General Labourer', area: 'Yard', must: ['Manual Handling Training'], should: ['White Card (General Construction Induction)'] },
      { name: 'Truck Driver (MR)', area: 'Dispatch', must: ['Driver Licence (MR, medium rigid)'], should: ['Chain of Responsibility Awareness'] },
      { name: 'Truck Driver (HR)', area: 'Dispatch', must: ['Driver Licence (HR, heavy rigid)'], should: ['Chain of Responsibility Awareness'] },
      { name: 'Delivery Driver', area: 'Dispatch', must: ['Driver Licence (C, car)'], should: ['National Police Check'] },
    ],
    shiftCodes: [
      { code: 'DAY', letter: 'D', name: 'Day', start: '06:00', end: '14:30', breakMinutes: 30 },
      { code: 'ARVO', letter: 'A', name: 'Afternoon', start: '14:00', end: '22:30', breakMinutes: 30 },
      { code: 'NIGHT', letter: 'N', name: 'Night', start: '22:00', end: '06:30', breakMinutes: 30 },
    ],
    equipmentTypes: [
      { name: 'Counterbalance forklift', operatorCredential: 'High Risk Work Licence: Forklift (LF)' },
      { name: 'Reach truck', operatorCredential: 'Reach Truck Training' },
      { name: 'Order picker', operatorCredential: 'High Risk Work Licence: Order Picker (LO)' },
      { name: 'Electric pallet jack', note: 'Track service dates' },
      { name: 'Delivery van', operatorCredential: 'Driver Licence (C, car)' },
      { name: 'Rigid truck (MR)', operatorCredential: 'Driver Licence (MR, medium rigid)' },
      { name: 'Rigid truck (HR)', operatorCredential: 'Driver Licence (HR, heavy rigid)' },
    ],
    items: [
      { name: 'Hi-vis vest', category: 'ppe', unit: 'each', costCents: 1200, reorderLevel: 10 },
      { name: 'Steel-cap boots (pair)', category: 'ppe', unit: 'pair', costCents: 8900, reorderLevel: 4 },
      { name: 'Work gloves (pair)', category: 'ppe', unit: 'pair', costCents: 800, reorderLevel: 20 },
      { name: 'Ear muffs', category: 'ppe', unit: 'each', costCents: 3500, reorderLevel: 4 },
      { name: 'Box cutter blades (pack of 10)', category: 'sundries', unit: 'pack', costCents: 700, reorderLevel: 10 },
      { name: 'Stretch wrap (roll)', category: 'sundries', unit: 'roll', costCents: 1800, reorderLevel: 12 },
      { name: 'Pallet labels (roll of 500)', category: 'sundries', unit: 'roll', costCents: 2200, reorderLevel: 4 },
      { name: 'LPG cylinder (forklift)', category: 'fuel', unit: 'cylinder', costCents: 6500, reorderLevel: 4 },
      { name: 'Diesel', category: 'fuel', unit: 'litre', costCents: 200 },
    ],
    duties: [
      { name: 'Drives a forklift', description: 'Operates a forklift on this shift', must: ['High Risk Work Licence: Forklift (LF)'] },
      { name: 'Drives a medium truck', description: 'Drives a medium rigid truck on this shift', must: ['Driver Licence (MR, medium rigid)'], should: ['Chain of Responsibility Awareness'] },
      { name: 'First aid officer', description: 'The nominated first aider on this shift', must: ['First Aid (HLTAID011)'] },
    ],
  },
  {
    id: 'traffic-management',
    name: 'Traffic management',
    description: 'Traffic control crews: traffic controller and implementer accreditations, White Card, TMA trucks, arrow boards and signage.',
    areas: ['Worksite', 'Depot'],
    credentials: [
      c('Traffic Controller Accreditation', 'licence', true, true, 'Check the accreditation card and state requirements'),
      c('Traffic Management Implementer Accreditation', 'licence', true, true, 'Check the accreditation card and state requirements'),
      c('Traffic Management Design / Planning', 'training', true, true, 'Sight statement of attainment'),
      WHITE_CARD, FIRST_AID, DRIVER_C, DRIVER_MR,
      c('Truck Mounted Attenuator (TMA) Training', 'training', true, true, 'Sight statement of attainment'),
    ],
    roles: [
      { name: 'Traffic Controller', area: 'Worksite', must: ['Traffic Controller Accreditation', 'White Card (General Construction Induction)'] },
      { name: 'Traffic Management Implementer', area: 'Worksite', must: ['Traffic Management Implementer Accreditation', 'Traffic Controller Accreditation', 'White Card (General Construction Induction)'], should: ['Driver Licence (C, car)'] },
      { name: 'Team Leader', area: 'Worksite', must: ['Traffic Management Implementer Accreditation', 'First Aid (HLTAID011)'] },
      { name: 'TMA Driver', area: 'Worksite', must: ['Driver Licence (MR, medium rigid)', 'Truck Mounted Attenuator (TMA) Training'] },
      { name: 'Traffic Planner', area: 'Depot', must: ['Traffic Management Design / Planning'] },
    ],
    shiftCodes: [
      { code: 'DAY', letter: 'D', name: 'Day works', start: '07:00', end: '15:30', breakMinutes: 30 },
      { code: 'NIGHT', letter: 'N', name: 'Night works', start: '20:00', end: '05:00', breakMinutes: 30 },
    ],
    equipmentTypes: [
      { name: 'TMA truck', operatorCredential: 'Truck Mounted Attenuator (TMA) Training' },
      { name: 'Traffic ute', operatorCredential: 'Driver Licence (C, car)' },
      { name: 'Arrow board trailer', note: 'Towed; track registration' },
      { name: 'Variable message sign (VMS) trailer', note: 'Towed; track registration' },
      { name: 'Portable traffic lights (pair)', note: 'Track service dates' },
    ],
    items: [
      { name: 'Traffic cone (700 mm)', category: 'tools', unit: 'each', costCents: 2200, reorderLevel: 40 },
      { name: 'Stop/slow bat', category: 'tools', unit: 'each', costCents: 9500, reorderLevel: 4 },
      { name: 'Hi-vis long-sleeve shirt', category: 'ppe', unit: 'each', costCents: 3500, reorderLevel: 10 },
      { name: 'Hi-vis night vest (reflective)', category: 'ppe', unit: 'each', costCents: 1800, reorderLevel: 10 },
      { name: 'Sandbags', category: 'sundries', unit: 'each', costCents: 300, reorderLevel: 50 },
      { name: 'Diesel', category: 'fuel', unit: 'litre', costCents: 200 },
    ],
    duties: [
      { name: 'Drives the TMA truck', description: 'Drives the truck mounted attenuator on this shift', must: ['Truck Mounted Attenuator (TMA) Training', 'Driver Licence (MR, medium rigid)'] },
      { name: 'Sets out the traffic plan', description: 'Implements the traffic management plan on site', must: ['Traffic Management Implementer Accreditation'] },
      { name: 'First aid officer', description: 'The nominated first aider on this shift', must: ['First Aid (HLTAID011)'] },
    ],
  },
  {
    id: 'cleaning',
    name: 'Cleaning and facilities',
    description: 'Commercial cleaning and facilities services: police and children checks, chemical training, machines and supplies.',
    areas: ['Client site', 'Depot'],
    credentials: [POLICE, WWCC, CHEMICAL, MANUAL, HEIGHTS, FIRST_AID, DRIVER_C, c('Floor Machine Competency', 'training', false, false, 'Supervisor sign-off')],
    roles: [
      { name: 'Cleaning Supervisor', area: 'Client site', must: ['National Police Check', 'Chemical Handling (SDS) Training'], should: ['First Aid (HLTAID011)'] },
      { name: 'Cleaner', area: 'Client site', must: ['National Police Check', 'Chemical Handling (SDS) Training'], should: ['Manual Handling Training'] },
      { name: 'School Cleaner', area: 'Client site', must: ['National Police Check', 'Working with Children Check', 'Chemical Handling (SDS) Training'] },
      { name: 'Window Cleaner', area: 'Client site', must: ['Working at Heights', 'National Police Check'] },
      { name: 'Floor Technician', area: 'Client site', must: ['Floor Machine Competency', 'Chemical Handling (SDS) Training'] },
    ],
    shiftCodes: [
      { code: 'EARLY', letter: 'E', name: 'Early clean', start: '05:00', end: '09:00', breakMinutes: 0 },
      { code: 'EVE', letter: 'EV', name: 'Evening clean', start: '17:00', end: '21:00', breakMinutes: 0 },
    ],
    equipmentTypes: [
      { name: 'Ride-on floor scrubber', operatorCredential: 'Floor Machine Competency' },
      { name: 'Pressure washer', note: 'Track service and test-and-tag dates' },
      { name: 'Service van', operatorCredential: 'Driver Licence (C, car)' },
    ],
    items: [
      { name: 'Multipurpose cleaner (5 L)', category: 'sundries', unit: 'drum', costCents: 2400, reorderLevel: 4 },
      { name: 'Bin liners (roll of 50)', category: 'sundries', unit: 'roll', costCents: 900, reorderLevel: 20 },
      { name: 'Microfibre cloths (pack of 10)', category: 'sundries', unit: 'pack', costCents: 1500, reorderLevel: 6 },
      { name: 'Nitrile gloves (box of 100)', category: 'ppe', unit: 'box', costCents: 1100, reorderLevel: 10 },
    ],
    duties: [
      { name: 'School or childcare site', description: 'Cleaning where children may be present', must: ['Working with Children Check'] },
      { name: 'Works at heights', description: 'Work at height on this shift (roofs, scaffolds, ladders)', must: ['Working at Heights'] },
      { name: 'Drives the company car', description: 'Drives between sites on this shift', must: ['Driver Licence (C, car)'] },
    ],
  },
  {
    id: 'security',
    name: 'Security and crowd control',
    description: 'Guarding, patrols and venue crowd control: state security licences, first aid and RSA.',
    areas: ['Venue', 'Client site', 'Patrol'],
    credentials: [
      c('Security Licence: Security Guard', 'licence', true, true, 'Check the state licensing register'),
      c('Security Licence: Crowd Controller', 'licence', true, true, 'Check the state licensing register'),
      FIRST_AID, RSA, POLICE, DRIVER_C,
    ],
    roles: [
      { name: 'Security Officer', area: 'Client site', must: ['Security Licence: Security Guard', 'First Aid (HLTAID011)'] },
      { name: 'Crowd Controller', area: 'Venue', must: ['Security Licence: Crowd Controller', 'First Aid (HLTAID011)'], should: ['Responsible Service of Alcohol (RSA)'] },
      { name: 'Patrol Officer', area: 'Patrol', must: ['Security Licence: Security Guard', 'Driver Licence (C, car)'] },
      { name: 'Security Supervisor', area: 'Client site', must: ['Security Licence: Security Guard', 'First Aid (HLTAID011)'] },
    ],
    shiftCodes: [
      { code: 'D12', letter: 'D', name: 'Day (12 h)', start: '07:00', end: '19:00', breakMinutes: 30 },
      { code: 'N12', letter: 'N', name: 'Night (12 h)', start: '19:00', end: '07:00', breakMinutes: 30 },
      { code: 'VENUE', letter: 'V', name: 'Venue night', start: '20:00', end: '03:00', breakMinutes: 0 },
    ],
    equipmentTypes: [{ name: 'Patrol car', operatorCredential: 'Driver Licence (C, car)' }, { name: 'Two-way radio', note: 'Issue per shift' }],
    items: [{ name: 'Body-worn camera batteries', category: 'tools', unit: 'each', costCents: 4500, reorderLevel: 4 }, { name: 'Security uniform shirt', category: 'ppe', unit: 'each', costCents: 4200, reorderLevel: 6 }],
    duties: [
      { name: 'Licensed venue', description: 'Crowd control where alcohol is served', must: ['Security Licence: Crowd Controller'], should: ['Responsible Service of Alcohol (RSA)'] },
      { name: 'Mobile patrol', description: 'Drives the patrol car on this shift', must: ['Driver Licence (C, car)'] },
      { name: 'First aid officer', description: 'The nominated first aider on this shift', must: ['First Aid (HLTAID011)'] },
    ],
  },
];

export const packById = (id: string) => PACKS.find(p => p.id === id);
