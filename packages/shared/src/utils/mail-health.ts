/**
 * Whether mail leaves the building — as far as the two processes that deal in
 * it can tell.
 *
 * "A provider key is set" was the whole test. But a key with a sender on a
 * domain the provider has not verified is refused on every message: nothing is
 * delivered, the API still answered "email sent", and the only trace was a line
 * in the worker's log. That mattered most where a mail is the ONLY copy of
 * something — a new account's temporary password — because the screen then
 * told a manager it had been mailed and showed it to nobody.
 *
 * Two facts decide it, and both live here so the API and the worker agree:
 *  - the sender address is one a provider could ever accept (`senderCanDeliver`);
 *  - the provider has not just refused us for a reason that is ours to fix
 *    (`isSenderRefusal`), which the worker records under `EMAIL_HEALTH_KEY`.
 */

/** Where the worker leaves its last word on delivery, in the queue's Redis DB. */
export const EMAIL_HEALTH_KEY = 'strata:email:health';
/** How long that word stands: long enough to warn, not so long it outlives a fix. */
export const EMAIL_HEALTH_TTL_SECONDS = 6 * 60 * 60;

/** What that key holds. */
export interface EmailHealth {
  ok: boolean;
  /** The provider's own words, when it refused. */
  reason?: string;
  at: string;
}

/**
 * Domains nobody can verify with a mail provider: the ones reserved for
 * documentation and testing (RFC 2606 / RFC 6761), and bare host names.
 * `noreply@example.com` is the placeholder this project ships in .env.example.
 */
const RESERVED_DOMAIN =
  /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost|local)$/i;

/** `Name <addr@domain>` or `addr@domain` → the domain, lower-cased; '' if neither. */
function domainOf(from: string): string {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const at = address.lastIndexOf('@');
  return at > 0 ? address.slice(at + 1).trim().toLowerCase() : '';
}

/** False when no provider could ever send from this address. */
export function senderCanDeliver(from: string | undefined | null): boolean {
  const domain = domainOf(String(from ?? ''));
  return domain.includes('.') && !RESERVED_DOMAIN.test(domain);
}

/**
 * Whether a refusal is about US — the sender or the key — rather than about one
 * message. A bad recipient address is refused too, and must not be read as
 * "this installation cannot send mail".
 */
export function isSenderRefusal(error: {
  message?: string;
  name?: string;
  statusCode?: number | null;
}): boolean {
  if (error.statusCode === 401 || error.statusCode === 403) return true;
  return /not verified|verify your domain|api key|unauthori[sz]ed|forbidden/i.test(
    `${error.name ?? ''} ${error.message ?? ''}`,
  );
}

/** Parse what `EMAIL_HEALTH_KEY` holds; null for nothing, or nothing readable. */
export function parseEmailHealth(raw: string | null | undefined): EmailHealth | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<EmailHealth>;
    return typeof value?.ok === 'boolean'
      ? { ok: value.ok, reason: value.reason, at: String(value.at ?? '') }
      : null;
  } catch {
    return null;
  }
}
