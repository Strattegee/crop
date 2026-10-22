import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { MeController } from './me.controller.js';
import { TokenVerifier } from './token-verifier.js';

@Module({
  controllers: [MeController],
  providers: [TokenVerifier, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
