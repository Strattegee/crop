/**
 * Function codes for screens (Steve, 26 Oct). Users never see them; they're for permissions, support and
 * reports, and stay the same whatever a business calls things. Full list: docs/CODES.md.
 */
export const FUNCTIONS = [
  { code: 1000, path: '/dashboard', label: 'Dashboard' },
  { code: 2000, path: '/roster', term: 1045, one: true },
  { code: 3000, path: '/workers', term: 1010 },
  { code: 3200, path: '/leave', label: 'Leave' },
  { code: 3500, path: '/compliance', label: 'Compliance' },
  { code: 4000, path: '/clients', term: 1015 },
  { code: 4100, path: '/facilities', term: 1020 },
  { code: 5000, path: '/equipment', term: 1060 },
  { code: 5500, path: '/items', term: 1070 },
  { code: 6000, path: '/messages', label: 'Messages' },
  { code: 9000, path: '/settings', label: 'Settings' },
  { code: 9900, path: '/platform', label: 'Platform', platformOnly: true },
] as const;
