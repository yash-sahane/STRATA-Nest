// Enable strict refresh so the reuse-rejection test verifies a rotated token is rejected.
process.env.AUTH_STRICT_REFRESH = 'true';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AllExceptionsFilter, generateId } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import { parseSetCookies } from '@strata/testing';
import { AppModule } from '../src/app.module';
import { NormalizedWsAdapter } from '../src/modules/realtime/normalized-ws-adapter';
import { PasswordService } from '../src/modules/auth/services/password.service';

/**
 * Live end-to-end auth flow evidence. REQUIRES a live Postgres + Redis.
 * Run: `pnpm --filter @strata/api test:e2e` with DATABASE_URL/REDIS_* pointing at them.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e.${Date.now()}@example.test`;
  const password = 'E2e-Password!1';
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new NormalizedWsAdapter(app)); // matches main.ts — AppModule has a WS gateway
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    const pw = new PasswordService();
    const user = await prisma.user.create({
      data: { id: generateId(), email, password: pw.hash(password), name: 'E2E User' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma && userId) {
      await prisma.workspaceMember.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await app?.close();
  });

  const server = () => app.getHttpServer();
  const login = (pw = password) => request(server()).post('/api/v1/auth/login').send({ email, password: pw });

  it('rejects bad credentials with a 400 error envelope', async () => {
    const res = await login('wrong-password');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error.code', 400);
  });

  it('login sets both cookies (HttpOnly, Path=/, SameSite=Lax) and returns {user, sessionId}', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.sessionId).toEqual(expect.any(String));
    const cookies = parseSetCookies(res.headers['set-cookie'] as unknown as string[]);
    expect(cookies.strata_access).toBeDefined();
    expect(cookies.strata_refresh).toBeDefined();
    expect(cookies.strata_access.attrs).toMatchObject({ path: '/', samesite: 'Lax' });
    expect('httponly' in cookies.strata_access.attrs).toBe(true);
  });

  it('me returns the profile with the access cookie; 401 without it', async () => {
    const l = await login();
    const withCookie = await request(server())
      .get('/api/v1/auth/me')
      .set('Cookie', l.headers['set-cookie'] as unknown as string[]);
    expect(withCookie.status).toBe(200);
    expect(withCookie.body.user.email).toBe(email);
    expect(withCookie.body.session.current).toBe(true);

    const noCookie = await request(server()).get('/api/v1/auth/me');
    expect(noCookie.status).toBe(401);
  });

  it('refresh rotates; REUSING the old refresh token is rejected (fixes D1)', async () => {
    const l = await login();
    const original = l.headers['set-cookie'] as unknown as string[];
    const first = await request(server()).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });

    const reuse = await request(server()).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(reuse.status).toBe(401);
    expect(reuse.body).toEqual({ message: 'Invalid refresh token' });
  });

  it('refresh without a cookie -> 401 {message}', async () => {
    const res = await request(server()).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Missing refresh token' });
  });

  it('change-password: wrong current -> 400 {message}; new password then works', async () => {
    const l = await login();
    const cookie = l.headers['set-cookie'] as unknown as string[];
    const wrong = await request(server())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'nope', newPassword: 'Newpass!2' });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ message: 'Current password is incorrect' });

    const ok = await request(server())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword: 'Newpass!2' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });

    expect((await login(password)).status).toBe(400); // old password rejected
    expect((await login('Newpass!2')).status).toBe(200); // new password accepted
  });

  it('logout clears cookies (204)', async () => {
    const l = await login('Newpass!2');
    const res = await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', l.headers['set-cookie'] as unknown as string[]);
    expect(res.status).toBe(204);
    const cleared = parseSetCookies(res.headers['set-cookie'] as unknown as string[]);
    expect(cleared.strata_access?.value).toBe('');
  });
});
