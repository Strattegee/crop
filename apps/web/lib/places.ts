export const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
export const CLIENT_STATUS: Record<string, [string, 'ok' | 'warn' | 'neutral']> = {
  active: ['Active', 'ok'], on_hold: ['On hold', 'warn'], inactive: ['Inactive', 'neutral'],
};
export const SPECIALTIES = ['Aged Care', 'Medical', 'Surgical', 'Emergency', 'Intensive Care', 'Mental Health', 'Paediatrics', 'Maternity', 'Rehabilitation', 'Community', 'Disability'];
