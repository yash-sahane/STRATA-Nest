import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global so every domain module can inject PrismaService directly. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
