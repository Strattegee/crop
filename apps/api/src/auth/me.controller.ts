import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { AuthContext } from './auth.types.js';
import { Auth, NoTenant } from './decorators.js';

@ApiBearerAuth()
@Controller('me')
export class MeController {
  /** The signed-in person and the agencies they can act in. */
  @NoTenant()
  @Get()
  me(@Auth() auth: AuthContext) {
    return { id: auth.userId, email: auth.email, name: auth.displayName, memberships: auth.memberships };
  }
}
