export const RTW_STATUS: Record<string, string> = {
  citizen: 'Australian citizen',
  nz_citizen: 'New Zealand citizen',
  permanent_resident: 'Permanent resident',
  visa_holder: 'Visa holder',
};
export const PROOF_LABEL: Record<string, string> = {
  au_passport: 'Australian passport',
  birth_certificate: 'Australian birth certificate',
  citizenship_certificate: 'Citizenship certificate',
};
export const RTW_ISSUE: Record<string, string> = {
  missing: 'Not recorded yet',
  no_work_rights: 'VEVO does not confirm work rights',
  rejected: 'Rejected — needs new details',
  expired: 'Visa has expired',
  unverified: 'Not verified yet',
  expiring: 'Visa expires soon',
};
export const VEVO_URL = 'https://immi.homeaffairs.gov.au/visas/already-have-a-visa/check-visa-details-and-conditions/check-conditions-online';
