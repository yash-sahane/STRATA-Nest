import { HealthController } from './health.controller';
import type { HealthReport, HealthService } from './health.service';

/**
 * Infra reads the status code, not the body: the image HEALTHCHECK, `docker
 * compose --wait` and any load balancer all treated `200 {"status":"degraded"}`
 * as healthy, so an API cut off from its database kept taking traffic.
 */
describe('HealthController', () => {
  const report = (db: boolean, redis: boolean): HealthReport => ({
    status: db && redis ? 'ok' : 'degraded',
    db,
    redis,
    ts: '2026-11-06T00:00:00.000Z',
  });
  const controllerFor = (r: HealthReport) =>
    new HealthController({ check: jest.fn().mockResolvedValue(r) } as unknown as HealthService);
  const fakeResponse = () => ({ status: jest.fn() });

  it('answers with the default 200 when both dependencies are up', async () => {
    const res = fakeResponse();
    const body = await controllerFor(report(true, true)).check(res as never);
    expect(res.status).not.toHaveBeenCalled();
    expect(body.status).toBe('ok');
  });

  it.each([
    ['the database', false, true],
    ['Redis', true, false],
  ])('answers 503 with the same body when %s is down', async (_what, db, redis) => {
    const res = fakeResponse();
    const body = await controllerFor(report(db, redis)).check(res as never);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(body).toMatchObject({ status: 'degraded', db, redis });
  });
});
