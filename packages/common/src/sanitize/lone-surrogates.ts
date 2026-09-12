import { Injectable, type PipeTransform } from '@nestjs/common';

/**
 * An unpaired UTF-16 surrogate: a high surrogate not followed by a low one, or
 * a low surrogate not preceded by a high one.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Drop unpaired surrogates from a string. A paired emoji is left alone. */
export function stripLoneSurrogates(value: string): string {
  return LONE_SURROGATE.test(value) ? value.replace(LONE_SURROGATE, '') : value;
}

/**
 * Characters Postgres refuses in a `text` column.
 *
 * NUL is the one that actually arrives: Postgres rejects \u0000 outright, so a
 * title carrying one came back as a bare 500 "Internal server error". Clients
 * send them by accident — a stray byte from a file paste, a C-string round trip
 * — never on purpose, so stripping is the honest response. The other C0 controls
 * are removed with it because none of them is text a user meant to type; TAB,
 * LF and CR are deliberately kept, since a textarea legitimately contains them.
 */
const UNSTORABLE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function stripUnstorableControls(value: string): string {
  return UNSTORABLE_CONTROLS.test(value) ? value.replace(UNSTORABLE_CONTROLS, '') : value;
}

/** Everything the inbound sanitiser removes from one string. */
export function sanitizeText(value: string): string {
  return stripUnstorableControls(stripLoneSurrogates(value));
}

/** Depth cap, so a hostile deeply-nested body cannot blow the stack here. */
const MAX_DEPTH = 12;

function clean(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = clean(value[i], depth + 1);
    return value;
  }
  // Only plain payload objects. Anything with an exotic prototype (a stream, a
  // class instance) is left untouched rather than walked.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  for (const key of Object.keys(value)) {
    (value as Record<string, unknown>)[key] = clean((value as Record<string, unknown>)[key], depth + 1);
  }
  return value;
}

/**
 * Strip the characters Postgres cannot store from every string in an inbound
 * request: unpaired UTF-16 surrogates and the C0 control codes (NUL included).
 *
 * A surrogate half is not a character: it cannot be encoded as UTF-8, so
 * Postgres refuses the write and the client gets a bare 500 "Internal server
 * error" with nothing to act on. Clients produce them without meaning to, by
 * slicing a string mid-emoji — the project-code generator took the first
 * character of "🚀 Launch Pad" and sent back half a rocket, and creating that
 * project failed with no usable message.
 *
 * Registered ahead of ValidationPipe in main.ts so every collection is covered
 * rather than the one that happened to be reported. Stripping (not rejecting)
 * is the right call: the user typed a valid emoji, and the broken half was
 * manufactured on the way here.
 */
@Injectable()
export class StripLoneSurrogatesPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return clean(value, 0);
  }
}
