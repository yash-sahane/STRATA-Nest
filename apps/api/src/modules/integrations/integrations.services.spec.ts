import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import {
  DiscordIntegrationsService,
  GitCommitsService,
  GitHubIntegrationsService,
} from './integrations.services';
import { IntegrationAccess } from './integration-access.service';
import { TokenCipher } from './token-cipher';
import { githubIntegrationResponse } from './mappers';

const user = { id: 'u1' } as User;
const cipher = new TokenCipher({ get: () => 'key' } as never as ConfigService);

describe('GitHubIntegrationsService.create — token encryption (D4)', () => {
  it('encrypts accessToken before persisting (plaintext never reaches the row)', async () => {
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ ...data, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }),
    );
    const prisma = { gitHubIntegration: { create } } as unknown as PrismaService;
    const ia = { assertProjectWrite: jest.fn().mockResolvedValue(undefined) } as unknown as IntegrationAccess;
    const svc = new GitHubIntegrationsService(prisma, ia, cipher);

    await svc.create(user, {
      projectId: 'p1',
      repoOwner: 'o',
      repoName: 'r',
      accessToken: 'ghp_secret_TOKEN',
    });

    expect(ia.assertProjectWrite).toHaveBeenCalledWith(user, 'p1', 'integration:write');
    const stored = create.mock.calls[0][0].data.accessToken as string;
    expect(stored).not.toContain('ghp_secret_TOKEN');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(cipher.decrypt(stored)).toBe('ghp_secret_TOKEN');
  });
});

describe('githubIntegrationResponse — token is write-only', () => {
  it('never includes accessToken in the serialized output', () => {
    const res = githubIntegrationResponse({
      id: 'g1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      projectId: 'p1',
      repoOwner: 'o',
      repoName: 'r',
      accessToken: 'enc:v1:whatever',
      webhookSecret: 's',
      autoUpdateStatus: true,
      enabledEvents: ['push'],
    } as never);
    expect(res).not.toHaveProperty('accessToken');
    expect(res).toMatchObject({ projectId: 'p1', repoOwner: 'o', autoUpdateStatus: true });
  });
});

describe('GitHubIntegrationsService — the webhook secret is server-minted', () => {
  const stored = {
    id: 'g1',
    projectId: 'p1',
    repoOwner: 'o',
    repoName: 'r',
    accessToken: 'enc:v1:x',
    webhookSecret: '',
    autoUpdateStatus: false,
    enabledEvents: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  function build() {
    const create = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...stored, ...data }));
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...stored, ...data }));
    const prisma = {
      gitHubIntegration: { create, update, findFirst: jest.fn().mockResolvedValue(stored) },
      project: { findUnique: jest.fn().mockResolvedValue({ workspaceId: 'w1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const ia = {
      assertProjectWrite: jest.fn().mockResolvedValue(undefined),
      scopeWhere: jest.fn().mockResolvedValue({}),
    } as unknown as IntegrationAccess;
    return { svc: new GitHubIntegrationsService(prisma, ia, cipher), create, update, ia };
  }

  it('create stores no secret, whatever the caller sends, and says so', async () => {
    const { svc, create } = build();
    const res = await svc.create(user, {
      projectId: 'p1',
      repoOwner: 'o',
      repoName: 'r',
      accessToken: 't',
      webhookSecret: 'secret',
    } as never);
    expect(create.mock.calls[0][0].data.webhookSecret).toBe('');
    expect(res).toMatchObject({
      webhookConfigured: false,
      webhookPath: '/integrations/github/webhook/p1',
    });
    expect(res).not.toHaveProperty('webhookSecret');
  });

  it('rotate mints one, stores it encrypted, and returns it once', async () => {
    const { svc, update, ia } = build();
    const res = await svc.rotateWebhookSecret(user, 'g1');
    expect(ia.assertProjectWrite).toHaveBeenCalledWith(user, 'p1', 'integration:write');
    expect(res.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    const written = update.mock.calls[0][0].data.webhookSecret as string;
    expect(written.startsWith('enc:v1:')).toBe(true);
    expect(cipher.decrypt(written)).toBe(res.webhookSecret);
    expect(res.webhookConfigured).toBe(true);
  });

  it('a second rotate replaces the first', async () => {
    const { svc } = build();
    const first = await svc.rotateWebhookSecret(user, 'g1');
    const second = await svc.rotateWebhookSecret(user, 'g1');
    expect(second.webhookSecret).not.toBe(first.webhookSecret);
  });
});

describe('DiscordIntegrationsService — only a Discord URL is ever stored', () => {
  function build() {
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ ...data, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') }),
    );
    const prisma = {
      discordIntegration: { create },
      project: { findUnique: jest.fn().mockResolvedValue({ workspaceId: 'w1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const ia = { assertProjectWrite: jest.fn().mockResolvedValue(undefined) } as unknown as IntegrationAccess;
    return { svc: new DiscordIntegrationsService(prisma, ia), create };
  }

  it.each([
    'http://127.0.0.1:8000/api/v1/health',
    'http://discord.com/api/webhooks/1/abc',
    'https://discord.com.evil.example/api/webhooks/1/abc',
    'https://discord.com/api/users/@me',
    'not a url',
  ])('refuses %s without storing it', async (webhookUrl) => {
    const { svc, create } = build();
    expect(() => svc.create(user, { projectId: 'p1', webhookUrl })).toThrow(
      'That is not a Discord webhook URL.',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('stores a real one, and never serializes it back whole', async () => {
    const { svc, create } = build();
    const webhookUrl = 'https://discord.com/api/webhooks/123456789012345678/tok-EN_value';
    const res = await svc.create(user, { projectId: 'p1', webhookUrl });
    expect(create.mock.calls[0][0].data.webhookUrl).toBe(webhookUrl);
    expect(JSON.stringify(res)).not.toContain('tok-EN_value');
    expect(res).toMatchObject({ webhookHint: '345678' });
  });
});

describe('GitCommitsService.list — commits for one task', () => {
  it('turns ?taskId= into a containment test on the linked ids', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      gitCommit: { findMany, count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const ia = {
      scopeWhere: jest.fn().mockResolvedValue({ projectId: { in: ['p1'] } }),
    } as unknown as IntegrationAccess;
    await new GitCommitsService(prisma, ia).list(user, { projectId: 'p1', taskId: 't1' });
    expect(findMany.mock.calls[0][0].where.AND).toEqual(
      expect.arrayContaining([
        { projectId: { in: ['p1'] } },
        { linkedTaskIds: { array_contains: ['t1'] } },
      ]),
    );
  });
});
