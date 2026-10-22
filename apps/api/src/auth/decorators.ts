import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthContext, AuthedRequest, MemberRole, Membership } from './auth.types.js';

export const IS_PUBLIC = 'crop:public';
export const NO_TENANT = 'crop:no-tenant';
export const ROLES = 'crop:roles';

/** No sign-in needed (health checks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Signed in, but not acting in a particular agency (e.g. /me). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);
/** Only these roles, in the current agency, may call the route. */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES, roles);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('@Auth() used on a public route');
  return auth;
});

/** The current agency; only valid on routes that are not @NoTenant(). */
export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): Membership => {
  const tenant = ctx.switchToHttp().getRequest<AuthedRequest>().auth?.tenant;
  if (!tenant) throw new Error('@Tenant() used without a tenant');
  return tenant;
});
