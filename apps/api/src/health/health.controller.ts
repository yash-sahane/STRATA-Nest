import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../modules/auth/decorators/public.decorator';
import { HealthService, type HealthReport } from './health.service';

// Not rate-limited: pollers hit this every few seconds by design, and the
// throttler keeps its counters in Redis — so with Redis down the one endpoint
// meant to SAY so waited on Redis first.
@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * GET /api/v1/health — readiness (DB + Redis). Public, used by infra.
   *
   * 503 when either dependency is down, with the same body. Everything that
   * polls this reads the STATUS CODE — the image's HEALTHCHECK (`wget` fails only
   * on non-2xx), `docker compose --wait`, a load balancer — and this answered 200
   * with `"status":"degraded"`, so an API that could not reach its database was
   * reported healthy and kept receiving traffic it could only fail.
   */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') res.status(503);
    return report;
  }
}
