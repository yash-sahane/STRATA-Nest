import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/services/password.service';
import { UserMapper } from './user.mapper';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserMapper, PasswordService],
  exports: [UserMapper],
})
export class UsersModule {}
