import { Transform } from 'class-transformer';

/**
 * Characters that occupy no space and carry no meaning at the edge of a value:
 * zero-width space, zero-width non-joiner, zero-width joiner, word joiner and
 * the byte-order mark.
 *
 * Trimmed only at the EDGES, exactly like whitespace. U+200D in the MIDDLE of a
 * string is load-bearing — it is what joins an emoji family into one glyph — so
 * stripping it globally would break every such character.
 *
 * Written as an explicit character class rather than interpolated into a
 * template literal: `\s` inside a template literal evaluates to the letter `s`,
 * which silently turns this into a rule that trims the letter s off names.
 */
const EDGE_BLANKS = /^[\s​‌‍⁠﻿]+|[\s​‌‍⁠﻿]+$/g;

/**
 * Trim a string field BEFORE validation runs.
 *
 * `@IsNotEmpty()` rejects `''` but happily accepts `'   '`, so a whitespace-only
 * value passed every "required" check in the app: nameless projects and tasks
 * were created with a success toast and rendered as blank cards no UI could
 * repair, and a whitespace-only Full Name on the Add Members form provisioned a
 * real user account and mailed them a welcome.
 *
 * `trim()` alone is not enough either: it leaves the zero-width characters
 * above, so a comment whose entire content was one U+200B passed `@IsNotEmpty()`
 * and rendered as a blank bubble nobody could identify or explain.
 *
 * The API's global ValidationPipe runs with `transform: true`, so this executes
 * on every request. Always place it before the validators it protects:
 *
 *     @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
 */
export function TrimmedText(): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.replace(EDGE_BLANKS, '') : value,
  );
}
