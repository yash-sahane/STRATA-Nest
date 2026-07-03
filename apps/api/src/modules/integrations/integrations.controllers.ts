import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '@lt/prisma';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import {
  CreateDiscordIntegrationDto,
  CreateGitCommitDto,
  CreateGitHubIntegrationDto,
  CreateGitLabIntegrationDto,
  UpdateDiscordIntegrationDto,
  UpdateGitCommitDto,
  UpdateGitHubIntegrationDto,
  UpdateGitLabIntegrationDto,
} from './dto';
import { GitQueueService } from './git-queue.service';
import {
  DiscordIntegrationsService,
  GitCommitsService,
  GitHubIntegrationsService,
  GitLabIntegrationsService,
} from './integrations.services';
import { normalizeCommits, verifyGithubSignature, verifyGitlabToken } from './webhook.util';

type Q = Record<string, string | string[] | undefined>;

@ApiTags('github_integrations')
@Controller('github_integrations')
export class GitHubIntegrationsController {
  constructor(private readonly svc: GitHubIntegrationsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateGitHubIntegrationDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateGitHubIntegrationDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateGitHubIntegrationDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

@ApiTags('gitlab_integrations')
@Controller('gitlab_integrations')
export class GitLabIntegrationsController {
  constructor(private readonly svc: GitLabIntegrationsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateGitLabIntegrationDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateGitLabIntegrationDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateGitLabIntegrationDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

@ApiTags('discord_integrations')
@Controller('discord_integrations')
export class DiscordIntegrationsController {
  constructor(private readonly svc: DiscordIntegrationsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateDiscordIntegrationDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateDiscordIntegrationDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateDiscordIntegrationDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

@ApiTags('git_commits')
@Controller('git_commits')
export class GitCommitsController {
  constructor(private readonly svc: GitCommitsService) {}
  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }
  @Post() create(@CurrentUser() u: User, @Body() d: CreateGitCommitDto) { return this.svc.create(u, d); }
  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Patch(':id') patch(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateGitCommitDto) { return this.svc.patch(u, id, d); }
  @Put(':id') put(@CurrentUser() u: User, @Param('id') id: string, @Body() d: UpdateGitCommitDto) { return this.svc.patch(u, id, d); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }
}

/**
 * [NEW, D-fix] Inbound provider webhooks. PUBLIC (external callers) — the
 * provider signature IS the authentication. Verify over the RAW body, then
 * enqueue a normalized job to the `git` queue; the worker does the writes.
 */
@ApiTags('integrations')
@Controller('integrations')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly git: GitQueueService,
  ) {}

  @Public()
  @Post('github/webhook/:projectId')
  @HttpCode(202)
  async github(
    @Param('projectId') projectId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
    @Headers('x-github-delivery') delivery: string,
  ) {
    const integration = await this.prisma.gitHubIntegration.findUnique({ where: { projectId } });
    if (!integration) throw new NotFoundException('No GitHub integration for this project.');
    const raw = req.rawBody ?? Buffer.from('');
    if (!verifyGithubSignature(raw, integration.webhookSecret, signature)) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    return this.dispatch('GITHUB', projectId, event, raw, delivery);
  }

  @Public()
  @Post('gitlab/webhook/:projectId')
  @HttpCode(202)
  async gitlab(
    @Param('projectId') projectId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-gitlab-token') token: string,
    @Headers('x-gitlab-event') event: string,
    @Headers('x-gitlab-event-uuid') delivery: string,
  ) {
    const integration = await this.prisma.gitLabIntegration.findUnique({ where: { projectId } });
    if (!integration) throw new NotFoundException('No GitLab integration for this project.');
    const raw = req.rawBody ?? Buffer.from('');
    if (!verifyGitlabToken(integration.webhookSecret, token)) {
      throw new UnauthorizedException('Invalid webhook token.');
    }
    return this.dispatch('GITLAB', projectId, event, raw, delivery);
  }

  private async dispatch(
    provider: 'GITHUB' | 'GITLAB',
    projectId: string,
    event: string,
    raw: Buffer,
    delivery?: string,
  ) {
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      /* non-JSON payloads (e.g. ping) → no commits */
    }
    const commits = normalizeCommits(payload);
    await this.git.enqueue({ provider, projectId, event: event ?? '', commits, deliveryId: delivery });
    return { accepted: true, commits: commits.length };
  }
}
