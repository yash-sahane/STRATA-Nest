import { Injectable } from '@nestjs/common';

/**
 * Hierarchy-id + FR-classification rules — a frozen, byte-exact contract the
 * frontend depends on. This is the most logic-heavy behaviour in generation, so
 * it lives in one tested unit and bulk-save composes it.
 */

/**
 * Ids probed before an allocator gives up. A project holding 25 consecutive
 * taken ids around the requested one is a caller bug, not a lost race.
 */
export const MAX_HIERARCHY_ID_ATTEMPTS = 25;

/**
 * Next candidate after a taken hierarchy id: bump the trailing numeric segment
 * in place, preserving its zero padding (`…-01` → `…-02`, `….09` → `….10`,
 * `…-99` → `…-100`). An id with no numeric tail is given one.
 *
 * Sequence numbers are derived from a COUNT, so a delete frees a number the
 * next create hands out again and two concurrent creates read the same count —
 * both produce a duplicate. Bumping is what turns that into the next free id.
 */
export function bumpHierarchyId(hierarchyId: string): string {
  const m = /^(.*[-.])(\d+)$/.exec(hierarchyId);
  if (!m) return `${hierarchyId}-01`;
  return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`;
}

/**
 * Duck-typed exactly like packages/common's exception filter (the Prisma error
 * classes are not worth importing for one `instanceof`): a unique-constraint
 * violation carries the class name and code P2002. `meta.target` names the
 * offending columns, so a collision on some OTHER unique index is never
 * mistaken for one an allocator can retry. A P2002 with no target is treated as
 * ours because `hierarchy_id` is the only non-primary unique key on these
 * tables and the primary key is a generated id that cannot collide.
 */
export function isHierarchyIdConflict(error: unknown): boolean {
  const e = error as {
    constructor?: { name?: string };
    code?: unknown;
    meta?: { target?: unknown };
  };
  if (e?.constructor?.name !== 'PrismaClientKnownRequestError' || e.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (target === undefined || target === null) return true;
  const columns = Array.isArray(target) ? target.join(',') : String(target);
  return columns.includes('hierarchy_id') || columns.includes('hierarchyId');
}

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

  /** See `bumpHierarchyId` — exposed on the service so injected callers get it too. */
  bump(hierarchyId: string): string {
    return bumpHierarchyId(hierarchyId);
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
