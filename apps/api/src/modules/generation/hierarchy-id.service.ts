import { Injectable } from '@nestjs/common';

/**
 * Hierarchy-id + FR-classification rules — a frozen, byte-exact contract the
 * frontend depends on. This is the most logic-heavy behaviour in generation, so
 * it lives in one tested unit and bulk-save composes it.
 */

// _TECHNICAL_KEYWORDS (exact set + order-independent).
const TECHNICAL_KEYWORDS = new Set([
  'api', 'database', 'code', 'implementation', 'backend', 'frontend', 'server',
  'endpoint', 'query', 'schema', 'migration', 'deploy', 'infrastructure',
  'architecture', 'integration', 'service', 'microservice', 'rest', 'graphql',
  'websocket', 'authentication', 'authorization', 'encryption', 'security',
  'cache', 'performance', 'optimization',
]);

@Injectable()
export class HierarchyIdService {
  /** _extract_chars: strip non-letters, take first `count`, uppercase. */
  extractChars(text: string, count: number): string {
    if (!text) return '';
    return text.replace(/[^a-zA-Z]/g, '').slice(0, count).toUpperCase();
  }

  /** Two-digit zero-pad (Python `:02d`). */
  pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  /**
   * FR-type classification: explicit TECHNICAL wins; else keyword scan of
   * title+description. NOTE: bulk-save intentionally does NOT call this — new
   * FRs take the schema's default type. Kept for completeness and future
   * server-side use.
   */
  classifyFrType(fr: { type?: string; title?: string; description?: string }): 'TECHNICAL' | 'FUNCTIONAL' {
    if ((fr.type ?? '').toUpperCase() === 'TECHNICAL') return 'TECHNICAL';
    const blob = `${(fr.title ?? '').toLowerCase()} ${(fr.description ?? '').toLowerCase()}`;
    for (const k of TECHNICAL_KEYWORDS) {
      if (blob.includes(k)) return 'TECHNICAL';
    }
    return 'FUNCTIONAL';
  }
}
