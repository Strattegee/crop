export type MemberRole = 'owner' | 'admin' | 'allocator' | 'supervisor' | 'worker' | 'client';

export interface Membership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: MemberRole;
  /**
   * The sites (and projects) they may use here (migration 0086): null = every site. Supervisors always have a list
   * (maybe empty); allocators only when an owner or admin chose sites for them. The database enforces it.
   */
  sites: string[] | null;
}

/** Who is making the request, attached by AuthGuard. */
export interface AuthContext {
  userId: string;
  email: string;
  displayName: string | null;
  memberships: Membership[];
  /** The agency this request acts in. Null only on routes marked @NoTenant(). */
  tenant: Membership | null;
}

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthContext;
}

/** Office roles; owner and admin can do everything an allocator can. */
export const OFFICE_ROLES: MemberRole[] = ['owner', 'admin', 'allocator'];

/**
 * Office roles plus supervisors (David, 4 Nov): only on endpoints a supervisor may use at their own sites (the
 * roster: read it, put people on, offer, confirm, take off; day requests; their projects' teams and equipment; the
 * business-wide numbers). Everything else stays OFFICE_ROLES, so a new endpoint is closed to supervisors unless
 * someone decides otherwise.
 */
export const SITE_ROLES: MemberRole[] = ['owner', 'admin', 'allocator', 'supervisor'];

/** Whether this person is limited to some sites in the business they're acting in. */
export const isLimited = (t: Membership | null | undefined): boolean => !!t && t.sites !== null;
