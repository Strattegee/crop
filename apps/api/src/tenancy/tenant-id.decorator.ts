import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TenantRequest } from './tenant.guard.js';

export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<TenantRequest>().tenantId;
  if (!id) throw new Error('TenantId used without TenantGuard');
  return id;
});
