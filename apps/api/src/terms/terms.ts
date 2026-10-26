/**
 * CROP's concepts, each with a fixed code. Screens, messages and reports show the business's own words
 * for these (business_terms), falling back to the defaults here. Codes never change; add new ones, never reuse.
 * The full list, with function codes for screens, is in docs/CODES.md.
 */
export interface TermDef { code: number; key: string; concept: string; singular: string; plural: string }

export const TERMS: TermDef[] = [
  { code: 1010, key: 'worker', concept: 'A person who works shifts', singular: 'Worker', plural: 'Workers' },
  { code: 1015, key: 'client', concept: 'A business the work is done for', singular: 'Client', plural: 'Clients' },
  { code: 1020, key: 'site', concept: 'A place where work happens', singular: 'Site', plural: 'Sites' },
  { code: 1030, key: 'area', concept: 'A part of a site, or a team', singular: 'Area', plural: 'Areas' },
  { code: 1040, key: 'shift', concept: 'A unit of work at a time and place', singular: 'Shift', plural: 'Shifts' },
  { code: 1045, key: 'roster', concept: 'The plan of who works when', singular: 'Roster', plural: 'Rosters' },
  { code: 1050, key: 'credential', concept: 'Proof someone is qualified or cleared', singular: 'Credential', plural: 'Credentials' },
  { code: 1055, key: 'role', concept: 'A job someone can do', singular: 'Role', plural: 'Roles' },
  { code: 1060, key: 'equipment', concept: 'Machines, vehicles and tools', singular: 'Equipment', plural: 'Equipment' },
  { code: 1070, key: 'item', concept: 'Things issued or used up', singular: 'Item', plural: 'Items' },
  { code: 1080, key: 'bank', concept: 'The pool of relief staff', singular: 'Bank', plural: 'Bank' },
  { code: 1090, key: 'agency', concept: 'An outside supplier of staff', singular: 'Agency', plural: 'Agencies' },
];

export type TermWords = Partial<Record<number, { singular: string; plural: string }>>;

/** Words an industry template suggests. Applied only where the business hasn't chosen its own. */
export const PACK_TERMS: Record<string, TermWords> = {
  healthcare: {
    1010: { singular: 'Staff member', plural: 'Staff' }, 1020: { singular: 'Facility', plural: 'Facilities' }, 1030: { singular: 'Ward', plural: 'Wards' },
    1050: { singular: 'Credential', plural: 'Credentials' }, 1070: { singular: 'Consumable', plural: 'Consumables' }, 1080: { singular: 'Bank', plural: 'Bank' },
  },
  hospitality: {
    1010: { singular: 'Team member', plural: 'Team' }, 1020: { singular: 'Venue', plural: 'Venues' }, 1030: { singular: 'Section', plural: 'Sections' },
    1050: { singular: 'Certificate', plural: 'Certificates' }, 1070: { singular: 'Stock item', plural: 'Stock' }, 1080: { singular: 'On-call pool', plural: 'On-call pool' },
  },
  construction: {
    1010: { singular: 'Worker', plural: 'Workers' }, 1020: { singular: 'Project', plural: 'Projects' }, 1030: { singular: 'Crew', plural: 'Crews' },
    1050: { singular: 'Ticket', plural: 'Tickets' }, 1060: { singular: 'Plant', plural: 'Plant' }, 1070: { singular: 'Material', plural: 'Materials' },
    1080: { singular: 'Casual pool', plural: 'Casual pool' },
  },
  'labour-hire': {
    1010: { singular: 'Candidate', plural: 'Candidates' }, 1020: { singular: 'Client site', plural: 'Client sites' }, 1030: { singular: 'Department', plural: 'Departments' },
    1040: { singular: 'Booking', plural: 'Bookings' }, 1050: { singular: 'Licence', plural: 'Licences' }, 1060: { singular: 'Fleet', plural: 'Fleet' },
    1070: { singular: 'PPE and stock', plural: 'PPE and stock' }, 1080: { singular: 'Pool', plural: 'Pool' },
  },
  'traffic-management': {
    1010: { singular: 'Crew member', plural: 'Crew' }, 1020: { singular: 'Worksite', plural: 'Worksites' }, 1030: { singular: 'Crew', plural: 'Crews' },
    1050: { singular: 'Ticket', plural: 'Tickets' }, 1060: { singular: 'Fleet', plural: 'Fleet' }, 1070: { singular: 'Gear', plural: 'Gear' },
  },
  cleaning: {
    1010: { singular: 'Cleaner', plural: 'Cleaners' }, 1020: { singular: 'Client site', plural: 'Client sites' }, 1030: { singular: 'Zone', plural: 'Zones' },
    1070: { singular: 'Supply', plural: 'Supplies' },
  },
  security: {
    1010: { singular: 'Officer', plural: 'Officers' }, 1020: { singular: 'Post', plural: 'Posts' }, 1030: { singular: 'Zone', plural: 'Zones' },
    1050: { singular: 'Licence', plural: 'Licences' },
  },
};

export const termByCode = (code: number) => TERMS.find(t => t.code === code);
