export type MemberRole = 'owner' | 'admin' | 'allocator' | 'worker' | 'client';

export interface Membership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: MemberRole;
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
