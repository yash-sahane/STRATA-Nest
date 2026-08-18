import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global so every (future) domain module can inject PrismaService directly (arch §3). */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
