import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthAuditService } from './auth-audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CookieService } from './services/cookie.service';
import { LoginAttemptStore } from './services/login-attempt.store';
import { PasswordService } from './services/password.service';
import { PasswordResetStore } from './services/password-reset.store';
import { RefreshTokenStore } from './services/refresh-token.store';
import { TokenService } from './services/token.service';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), UsersModule, AuthzModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthAuditService,
    JwtStrategy,
    CookieService,
    PasswordService,
    TokenService,
    RefreshTokenStore,
    PasswordResetStore,
    LoginAttemptStore,
  ],
  exports: [TokenService, PasswordService, RefreshTokenStore, CookieService],
})
export class AuthModule {}
