import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../modules/auth/decorators/public.decorator';
import { HealthService, type HealthReport } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** GET /api/v1/health — liveness/readiness (DB + Redis). Public, used by infra. */
  @Public()
  @Get()
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
