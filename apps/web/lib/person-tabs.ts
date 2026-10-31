/** The tabs on a person's page (David, 31 Oct), with a small flag where something needs doing. Pure, tested. */
export type PersonTab = 'overview' | 'credentials' | 'rtw' | 'employment' | 'availability' | 'shifts' | 'details';

export function personTabs(x: {
  issues: { typeName: string; severity: string; problem: string }[]; rtwIssue: string | null; onboarding: boolean;
  words: { credentials: string; shifts: string };
}): { id: PersonTab; label: string; flag?: string; flagTitle?: string }[] {
  // Must-have problems block work; expiring and should-haves don't count here.
  const blocking = x.issues.filter(i => i.severity === 'hard' && i.problem !== 'expiring' && i.typeName !== 'Right to work').length;
  return [
    { id: 'overview', label: 'Overview', ...(x.onboarding ? { flag: '•', flagTitle: 'Onboarding in progress' } : {}) },
    { id: 'credentials', label: x.words.credentials, ...(blocking ? { flag: String(blocking), flagTitle: `${blocking} to fix before they can work` } : {}) },
    { id: 'rtw', label: 'Right to work', ...(x.rtwIssue ? { flag: '!', flagTitle: 'Needs attention' } : {}) },
    { id: 'employment', label: 'Employment' },
    { id: 'availability', label: 'Availability & leave' },
    { id: 'shifts', label: x.words.shifts },
    { id: 'details', label: 'Details' },
  ];
}
