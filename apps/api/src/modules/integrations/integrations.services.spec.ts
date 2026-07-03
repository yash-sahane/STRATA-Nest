import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@lt/prisma';
import type { User } from '@prisma/client';
import { GitHubIntegrationsService } from './integrations.services';
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
