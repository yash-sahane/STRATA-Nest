import { Transform } from 'class-transformer';

/**
 * Trim a string field BEFORE validation runs.
 *
 * `@IsNotEmpty()` rejects `''` but happily accepts `'   '`, so a whitespace-only
 * value passed every "required" check in the app: nameless projects and tasks
 * were created with a success toast and rendered as blank cards no UI could
 * repair, and a whitespace-only Full Name on the Add Members form provisioned a
 * real user account and mailed them a welcome.
 *
 * The API's global ValidationPipe runs with `transform: true`, so this executes
 * on every request. Always place it before the validators it protects:
 *
 *     @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
 */
export function TrimmedText(): PropertyDecorator {
  return Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
}
