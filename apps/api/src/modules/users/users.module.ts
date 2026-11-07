import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/services/password.service';
import { RefreshTokenStore } from '../auth/services/refresh-token.store';
import { UserMapper } from './user.mapper';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  // RefreshTokenStore: re-issuing a temporary password signs the account out
  // everywhere. It holds no state of its own (the tokens live in Redis).
  providers: [UsersService, UserMapper, PasswordService, RefreshTokenStore],
  // UsersService: a workspace created for somebody adds them the way an invite does.
  exports: [UserMapper, UsersService],
})
export class UsersModule {}
