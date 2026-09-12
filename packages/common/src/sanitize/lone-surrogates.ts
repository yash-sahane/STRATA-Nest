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

/** Depth cap, so a hostile deeply-nested body cannot blow the stack here. */
const MAX_DEPTH = 12;

function clean(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return stripLoneSurrogates(value);
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
 * Strip unpaired UTF-16 surrogates from every string in an inbound request.
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
