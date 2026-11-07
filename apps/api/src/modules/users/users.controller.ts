import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InviteUserDto, ReissueTempPasswordDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('invite')
  async invite(
    @CurrentUser() caller: User,
    @Body() dto: InviteUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.users.invite(caller, dto);
    if ('softError' in result) {
      res.status(result.softError.status);
      return { message: result.softError.message };
    }
    res.status(result.status);
    return result.body;
  }

  @Get()
  list(
    @CurrentUser() caller: User,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    return this.users.list(caller, query);
  }

  @Get(':id')
  retrieve(@CurrentUser() caller: User, @Param('id') id: string) {
    return this.users.retrieve(caller, id);
  }

  /** A new temporary password for somebody who cannot sign in — see the service. */
  @Post(':id/temp-password')
  reissueTempPassword(
    @CurrentUser() caller: User,
    @Param('id') id: string,
    @Body() dto: ReissueTempPasswordDto,
  ) {
    return this.users.reissueTempPassword(caller, id, dto.workspaceId);
  }

  @Patch(':id')
  async update(
    @CurrentUser() caller: User,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.users.update(caller, id, dto);
    if ('softError' in result) {
      res.status(result.softError.status);
      return { message: result.softError.message };
    }
    return result;
  }
}
