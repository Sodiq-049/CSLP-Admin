import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { ScopeResolverRegistry } from './scope-resolver.registry.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    AccountService,
    SessionService,
    TokenService,
    MfaService,
    ScopeResolverRegistry,
    AuthGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    SessionService,
    TokenService,
    MfaService,
    ScopeResolverRegistry,
    AuthGuard,
    PermissionsGuard,
  ],
})
export class AuthModule {}
