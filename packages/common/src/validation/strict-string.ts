import { Transform } from 'class-transformer';

/**
 * Stop `enableImplicitConversion` turning a non-string into a string.
 *
 * The API's global ValidationPipe runs with `transform: true` and
 * `enableImplicitConversion: true` (apps/api/src/main.ts). class-transformer then
 * coerces each value towards the property's reflected type BEFORE validators
 * run, and for a `string` property that coercion is effectively `String(value)`.
 * So `@IsString()` can never fail: `{"title": 12345}` arrived as the string
 * "12345", and `{"content": {...}}` was stored as the literal text
 * "[object Object]" — a comment nobody wrote, in a thread nobody can repair.
 *
 * `obj[key]` is the value the client actually sent, before conversion. Handing
 * that back unchanged lets `@IsString()` reject it, which is what it was written
 * to do. Place it directly above `@IsString()`:
 *
 *     @StrictString() @IsString() @IsNotEmpty() title!: string;
 */
export function StrictString(): PropertyDecorator {
  return Transform(({ obj, key }) => (obj ?? {})[key]);
}
