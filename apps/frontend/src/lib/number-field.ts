import type { SyntheticEvent } from 'react';

/**
 * Keep react-hook-form in step with an `<input type="number">` whose content the
 * browser cannot parse.
 *
 * Chrome reports every unparseable number — "e", "-", ".", a pasted "abc" — as
 * `value: ""` with `validity.badInput` set. React's change plugin only
 * dispatches `onChange` when the value STRING actually changes, so on an empty
 * field the first bad keystroke goes `"" -> ""` and React suppresses it
 * entirely: the form never learns anything is wrong, the field validates as "no
 * value", and the record saves with the typo silently dropped.
 *
 * Measured, because it is easy to get the wrong idea about this: typing "e" into
 * an EMPTY field creates the task with no message, while typing it into a field
 * already holding "5" reports "Estimated hours must be a number" — because
 * `"5" -> ""` is a real change and does fire. So the onChange handler is fine;
 * the event simply never arrives on the path that matters.
 *
 * `keyup` and `blur` are delivered regardless of whether the value changed, so
 * that is where the badInput state is mirrored into the form as NaN. NaN is a
 * value the schema can reject with a message; "" is indistinguishable from a
 * field the user deliberately left blank.
 *
 * Attach BOTH — keyup covers typing, blur covers paste and drag-drop, which
 * produce no key events:
 *
 *     onKeyUp={syncBadInput(field)}
 *     onBlur={(event) => { syncBadInput(field)(event); field.onBlur(); }}
 */
export function syncBadInput(field: { value: unknown; onChange: (value: unknown) => void }) {
  return (event: SyntheticEvent<HTMLInputElement>) => {
    const el = event.currentTarget;
    const holdsNaN = typeof field.value === 'number' && Number.isNaN(field.value);
    if (el.validity.badInput) {
      if (!holdsNaN) field.onChange(NaN);
    } else if (holdsNaN) {
      // The user cleared the bad characters — hand the real value back so the
      // field stops reporting an error it no longer has.
      field.onChange(el.value);
    }
  };
}
