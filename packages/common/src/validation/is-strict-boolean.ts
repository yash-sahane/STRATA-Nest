import { Transform } from 'class-transformer';

/**
 * Normalises a boolean field's RAW request value before validation, so that
 * `@IsBoolean()` can actually reject non-booleans.
 *
 * The API's global ValidationPipe runs with `enableImplicitConversion: true`
 * (apps/api/src/main.ts). class-transformer then coerces each value towards the
 * property's reflected type BEFORE validators run, and for a boolean property
 * that coercion is effectively `Boolean(value)`. The consequence is that
 * `@IsBoolean()` never fails: every non-empty string arrives as `true` —
 * including the string `'false'`. A client sending `{"archived":"false"}` had
 * `true` stored, with no error surfaced anywhere.
 *
 * `obj[key]` is read instead of the already-converted `value`, so this sees what
 * the client actually sent regardless of what implicit conversion did to it.
 * Recognised spellings are mapped to real booleans; anything else is passed
 * through untouched for `@IsBoolean()` to reject.
 *
 * Always place it directly above `@IsBoolean()`:
 *
 *     @IsOptional() @IsStrictBoolean() @IsBoolean() archived?: boolean;
 */
export function IsStrictBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const raw = (obj ?? {})[key];
    if (raw === undefined || typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === '1' || raw === 1) return true;
    if (raw === 'false' || raw === '0' || raw === 0) return false;
    return raw;
  });
}
