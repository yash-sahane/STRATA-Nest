import { Module } from '@nestjs/common';
import {
  DiscordIntegrationsController,
  GitCommitsController,
  GitHubIntegrationsController,
  GitLabIntegrationsController,
  WebhookController,
} from './integrations.controllers';
import {
  DiscordIntegrationsService,
  GitCommitsService,
  GitHubIntegrationsService,
  GitLabIntegrationsService,
} from './integrations.services';
import { GitQueueService } from './git-queue.service';
import { IntegrationAccess } from './integration-access.service';
import { TokenCipher } from './token-cipher';

/**
 * Integrations. CRUD for the 4 collections (tokens encrypted at rest
 * + write-only), project→workspace scoping, and public webhook
 * receivers that verify signatures and enqueue to the `git` queue.
 */
@Module({
  controllers: [
    GitHubIntegrationsController,
    GitLabIntegrationsController,
    DiscordIntegrationsController,
    GitCommitsController,
    WebhookController,
  ],
  providers: [
    GitHubIntegrationsService,
    GitLabIntegrationsService,
    DiscordIntegrationsService,
    GitCommitsService,
    IntegrationAccess,
    TokenCipher,
    GitQueueService,
  ],
  exports: [IntegrationAccess, GitQueueService], // used by DeletionModule (Zone-2 cleanup + integration delete)
})
export class IntegrationsModule {}
