import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * AiModule = INFRA seam (arch: AiModule ≠ GenerationModule). Today the frontend
 * calls the model directly and only PERSISTENCE is server-side (GenerationModule
 * / bulk-save), so this service intentionally does no model calls. It exists to
 * mark the boundary: if/when generation moves server-side, the prompt/model
 * plumbing lands here and GenerationModule stays pure persistence.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('Ai');

  constructor(private readonly config: ConfigService) {}

  /** Whether the server performs generation (false today — client-side). */
  isServerSideGenerationEnabled(): boolean {
    return false;
  }
}
