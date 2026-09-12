import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { IntegrationAccess } from './integration-access.service';
import { TokenCipher } from './token-cipher';

/**
 * Does a stored integration credential actually work?
 *
 * Nothing asked before this. All three providers accepted an access token or a
 * webhook URL, encrypted it, stored it, and never called the provider — so a
 * garbage token and a repository that does not exist saved successfully, and the
 * first sign of trouble was commits silently never arriving. A broken
 * integration was indistinguishable from a working one, from the API and from
 * the UI alike.
 *
 * The result is written back to the row (lastTestedAt / lastTestOk /
 * lastTestError) so "never verified" and "verified and failing" are states
 * somebody can see, rather than the same blank.
 */
@Injectable()
export class IntegrationTestService {
  private readonly logger = new Logger('IntegrationTest');

  /**
   * A provider that accepts the connection and never answers must not hold this
   * request open — the AI route had exactly that bug. Ten seconds is generous for
   * a metadata read.
   */
  private static readonly TIMEOUT_MS = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: IntegrationAccess,
    private readonly cipher: TokenCipher,
  ) {}

  /** GitHub: can this token see this repository? */
  async testGitHub(user: User, id: string) {
    const row = await this.prisma.gitHubIntegration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Not found.');
    await this.access.assertProjectWrite(user, row.projectId, Permission.IntegrationWrite);

    const result = await this.probe(
      `https://api.github.com/repos/${encodeURIComponent(row.repoOwner)}/${encodeURIComponent(row.repoName)}`,
      {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.decrypt(row.accessToken)}`,
        'User-Agent': 'strata-integration-test',
      },
      {
        401: 'The access token was rejected. It may be expired or revoked.',
        403: 'The token is valid but not allowed to read this repository (check its scopes).',
        404: `No repository "${row.repoOwner}/${row.repoName}" is visible to this token.`,
      },
    );
    return this.record('gitHubIntegration', id, result);
  }

  /** GitLab: can this token see this project? */
  async testGitLab(user: User, id: string) {
    const row = await this.prisma.gitLabIntegration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Not found.');
    await this.access.assertProjectWrite(user, row.projectId, Permission.IntegrationWrite);

    const result = await this.probe(
      // GitLab identifies a project by its URL-encoded full path.
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(row.projectPath)}`,
      { 'PRIVATE-TOKEN': this.decrypt(row.accessToken) },
      {
        401: 'The access token was rejected. It may be expired or revoked.',
        403: 'The token is valid but not allowed to read this project.',
        404: `No project "${row.projectPath}" is visible to this token.`,
      },
    );
    return this.record('gitLabIntegration', id, result);
  }

  /**
   * Discord: is this webhook still live?
   *
   * A GET on a webhook URL returns the webhook object and does NOT post a
   * message, so testing the configuration cannot spam the channel it points at.
   */
  async testDiscord(user: User, id: string) {
    const row = await this.prisma.discordIntegration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Not found.');
    await this.access.assertProjectWrite(user, row.projectId, Permission.IntegrationWrite);

    // Refuse to send the request anywhere but Discord: a stored URL is
    // attacker-influenced input, and this call is made by the server.
    let host: string;
    try {
      host = new URL(row.webhookUrl).host.toLowerCase();
    } catch {
      return this.record('discordIntegration', id, {
        ok: false,
        detail: 'The webhook URL is not a valid URL.',
      });
    }
    if (host !== 'discord.com' && host !== 'discordapp.com' && !host.endsWith('.discord.com')) {
      return this.record('discordIntegration', id, {
        ok: false,
        detail: `The webhook URL points at ${host}, which is not Discord.`,
      });
    }

    const result = await this.probe(
      row.webhookUrl,
      {},
      {
        401: 'Discord rejected this webhook URL.',
        404: 'This webhook no longer exists — it may have been deleted in Discord.',
      },
    );
    return this.record('discordIntegration', id, result);
  }

  private decrypt(stored: string): string {
    try {
      return this.cipher.decrypt(stored);
    } catch {
      // A row written under a different key, or corrupted. Returning a token the
      // provider will reject gives the user a clearer answer than a 500.
      return '';
    }
  }

  /** One GET, bounded, with a message per status worth explaining. */
  private async probe(
    url: string,
    headers: Record<string, string>,
    messages: Record<number, string>,
  ): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(IntegrationTestService.TIMEOUT_MS),
      });
      if (response.ok) return { ok: true, detail: 'Connected successfully.' };
      const explained = messages[response.status];
      return {
        ok: false,
        detail: explained ?? `The provider answered ${response.status}.`,
      };
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        return {
          ok: false,
          detail: `The provider did not respond within ${IntegrationTestService.TIMEOUT_MS / 1000}s.`,
        };
      }
      // Never surface the raw error: it can carry the URL, and for GitLab/GitHub
      // the URL is fine but the habit is not.
      this.logger.warn(`integration test failed: ${error instanceof Error ? error.message : error}`);
      return { ok: false, detail: 'Could not reach the provider.' };
    }
  }

  /**
   * Persist the verdict. This is the part that makes the test worth having: a
   * one-off answer in an HTTP response tells nobody, later, whether the
   * integration was ever known to work.
   */
  private async record(
    model: 'gitHubIntegration' | 'gitLabIntegration' | 'discordIntegration',
    id: string,
    result: { ok: boolean; detail: string },
  ) {
    const testedAt = new Date();
    await (this.prisma[model] as { update: (a: unknown) => Promise<unknown> }).update({
      where: { id },
      data: {
        lastTestedAt: testedAt,
        lastTestOk: result.ok,
        // Empty rather than null on success, so "tested and fine" is not confused
        // with "never tested".
        lastTestError: result.ok ? '' : result.detail,
      },
    });
    return { ok: result.ok, detail: result.detail, testedAt: testedAt.toISOString() };
  }
}
