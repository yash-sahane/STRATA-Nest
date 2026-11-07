// The standing regression suite: everything already fixed and verified, re-run
// as one pass. Run this after ANY further change to confirm nothing regressed.
//
//   node regression-suite.mjs
//
// It shells out to the individual proof scripts so each one stays runnable on
// its own, and reports one combined tally.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['verify-harness-session.mjs', 'the harness renews an expired session (self-check)'],
  ['security-fixes.mjs', 'comment authorship, realtime payload, inert uploads'],
  ['verify-socket-hardening.mjs', 'a malformed socket cookie is refused, not fatal; credential and audit frames carry the id alone'],
  ['verify-file-roundtrip.mjs', 'an attachment comes back byte for byte, name intact'],
  ['auth-fixes.mjs', 'e-mail case, logout, webhook secret'],
  ['verify-session-expiry.mjs', 'a form survives its own session expiring, and fails loudly when it cannot'],
  ['verify-offline-save.mjs', 'a save survives the connection dropping, and says the connection is why'],
  ['verify-workspace-refetch-blip.mjs', 'a workspace list that fails to refresh keeps the page; one that never came says so'],
  ['verify-invitation-consent.mjs', 'being added is an invitation the person accepts or declines, and nobody answers it for them'],
  ['verify-concurrent-edit.mjs', 'two people editing one record: neither loses work silently'],
  ['verify-stale-baseline.mjs', 'a save is checked against what the person was looking at, not what the record became'],
  ['verify-optimistic-locking.mjs', 'the same field is refused, a different one is not (API, 5 collections)'],
  ['verify-board-drag.mjs', 'dragging a card between columns persists, by keyboard'],
  ['verify-rate-limited-ui.mjs', 'a rate-limited page explains itself instead of looking empty'],
  ['verify-rate-limit-recovery.mjs', 'a rate-limited background refetch recovers instead of going quietly stale'],
  ['integrity-fixes.mjs', 'attendance, approved time entries, leave races, 500s'],
  ['api-validation.mjs', 'cross-workspace parents, time arithmetic, blank/oversized text, files'],
  ['destructive-contrast.mjs', 'destructive text clears AA in both themes'],
  ['verify-toast-contrast.mjs', 'all four coloured toast types clear AA in both themes'],
  ['ui-fixes.mjs', 'workspace-fetch failure, palette, notifications keyboard, 110 rows'],
  ['ui-fixes2.mjs', '?action=create, notification panel focus'],
  ['ui-fixes3.mjs', 'error states, keyboard reach, focus return, bulk notifications'],
  ['verify-attendance-truth.mjs', 'no absences the app cannot know about'],
  ['verify-hr-rules.mjs', 'holidays reconcile leave and attendance; who is away; sole approver; midnight shifts (API)'],
  ['verify-hr-screens.mjs', 'the leave and attendance screens say what the API knows: sole approvers, who is away, sickness after the fact, forgotten check-outs'],
  ['verify-timezone-day.mjs', 'browser and server agree which day it is, in any timezone'],
  ['verify-workspace-timezone.mjs', 'a workspace declares which timezone its working day belongs to'],
  ['verify-password-trio.mjs', 'change-password reachability and the enforced policy'],
  ['verify-account-recovery.mjs', "a lost temporary password can be re-issued; mail that cannot be sent is not promised; a colleague's account is not everybody's to read"],
  ['verify-consistent-numbers.mjs', 'sprint/board/workload/search figures that agree'],
  ['verify-delivery-flow.mjs', 'a task follows its requirement; a completed sprint is a record; requirements can be edited'],
  ['verify-delivery-server.mjs', 'the server keeps requirement, epic and tasks in step with no browser in the loop (API)'],
  ['verify-reachable-rows.mjs', 'clickable rows, dead controls, 390px clipping'],
  ['verify-ai-timers.mjs', 'AI generation timeouts and the progress-timer leak'],
  ['verify-realtime-coalesce.mjs', 'one refetch per burst, never zero'],
  ['verify-integrations.mjs', 'integration credentials are verifiable, and reachable'],
  ['verify-low-severity-fixes.mjs', 'mis-severitied lows: leaks, oracles, dead links'],
  ['verify-blocked-actions.mjs', 'actions the UI refused but the server allows'],
  ['verify-realtime-coverage.mjs', 'collections the server broadcast to nobody'],
  ['verify-access-live.mjs', 'a change to a role reaches the screen its holder has open'],
  ['verify-reach-ends.mjs', "a grant stops at its own workspace and record; an ended session is over; frames reach only their own (API)"],
  ['verify-who-does-what.mjs', 'testers file tasks; re-planning is planning; the only approver decides their own; screens offer what the server allows'],
  ['verify-people-flows.mjs', 'a workspace made for somebody, handed on, left; access lost is said; removal tidies; one place to add people'],
  ['verify-told-once.mjs', 'told once, never about your own doing; a project copied whole in one request; the bell pages and opens where the business is'],
  ['verify-delivery-chain.mjs', 'the delivery chain links both ways, makes the next step in place, reviews in the task, and keeps a closed sprint as it was'],
  ['verify-attachments.mjs', 'a file is attached to a task or a client requirement, where the work is, and outlives a deleted one among the project files'],
  ['verify-data-rules.mjs', 'records take only values their screens can show; a project is archived by its status alone; routes nothing uses are gone'],
  ['verify-follow-through.mjs', 'a client requirement follows its work; a sprint completes once; two edges at once both land; leave under way is ended early'],
  ['verify-wiring.mjs', 'what can be clicked looks it and says why when it cannot; the phone menu, search and palette work from any input; the server mints ids; nothing dead is left'],
  ['verify-url-state.mjs', 'tab state and deep links the URL should carry'],
  ['verify-notification-routing.mjs', 'every real notification type leads somewhere'],
  ['verify-told-when-out.mjs', 'somebody removed, switched off or declined is told, in an inbox they can still open (API)'],
  ['verify-people-are-told.mjs', 'comments, un-assignment, attendance and leave changes, and commit-moved tasks each tell the people concerned (API)'],
  ['verify-plural-and-filters.mjs', '"1 days", and a roster misreporting custom roles'],
  ['verify-surfaced-data.mjs', 'data collected or loaded and never shown'],
  ['verify-hidden-info.mjs', 'information the UI held and withheld'],
  ['verify-form-affordances.mjs', 'credential hints, focus, and abandoned input'],
  ['verify-calendar-and-invite.mjs', 'who is away, and a code typed in lower case'],
  ['verify-a11y-names.mjs', 'every control can be named (24 screens, axe)'],
  ['verify-a11y-structure.mjs', 'the rest of WCAG A/AA across 18 routes (self-testing)'],
  ['verify-keyboard-journey.mjs', 'the app is operable without a mouse (focus trap, restore, skip link)'],
  ['verify-reflow.mjs', '320px and 200% zoom reflow without clipping or overlap (self-testing)'],
  ['verify-scroll-reachability.mjs', 'nothing is cut off the START of a scrolling strip, where no scroll can reach it'],
  ['verify-hover-affordance.mjs', 'every control responds to hover and shows a pointer (self-testing)'],
  ['verify-layout-shift.mjs', 'content does not jump about while a page loads (self-testing)'],
  ['verify-slow-load-shift.mjs', 'a page stays still when one of its queries answers late (self-testing)'],
  ['verify-data-volume.mjs', '2500 tasks: the pages still load, and the figures are the real ones'],
  ['verify-timesheet-tags.mjs', 'tags collected and never shown'],
  ['verify-time-visibility.mjs', "a task's logged time is the whole team's; a running timer shows from anywhere"],
  ['verify-motion-and-loading.mjs', 'detail-dialog loading state, W badge width, live motion scale'],
  ['verify-motion-scale.mjs', 'every transition runs at one of the four declared durations (self-testing)'],
  ['verify-dialog-footers.mjs', 'two detail dialogs that hand-rolled their action row'],
  ['verify-ink-on-card.mjs', 'raw-palette text ink clears its contrast floor on the card'],
  ['verify-strength-meter.mjs', 'the password bar is readable against its track, and agrees with its own words'],
  ['verify-calendar-legend.mjs', 'every colour the attendance calendar paints has a key, and legible ink'],
  ['verify-priority-vocabulary.mjs', 'the priority picker agrees with the priority it produces'],
  ['verify-lab-parser.mjs', 'the lab() colour parser agrees with what the browser paints'],
  ['verify-indicator-contrast.mjs', 'progress bars are distinguishable from their tracks (non-text contrast)'],
  ['verify-one-way-to-say-it.mjs', 'one definition of overdue, one edit form, one password form, one wording for no access; search reaches client requirements'],
  // Last: it makes a dozen sign-in attempts, and the per-address limit it runs into is
  // shared with every script after it.
  ['verify-signin-hardening.mjs', 'sign-in failures are counted per account; a write must come from one of ours; refresh tokens have their own key (API)'],
];

const run = (script) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, script)], { cwd: HERE });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ out, code }));
  });

// Printed so a stray concurrent run is obvious in the output rather than
// silently interleaving with this one. Two runs writing the same redirect
// file produced a summary whose rows carried other scripts' numbers.
const SUITE_RUN_LABEL = `pid ${process.pid}`;
console.log(`
[regression-suite ${SUITE_RUN_LABEL}] starting ${SUITES.length} scripts`);

const rows = [];
for (const [script, what] of SUITES) {
  process.stdout.write(`\n${'='.repeat(72)}\n${script} — ${what}\n${'='.repeat(72)}\n`);
  const { out, code } = await run(script);
  const tally = out.match(/total (\d+)\s+passed (\d+)\s+failed (\d+)(?:\s+skipped (\d+))?/);
  // Keep each FAIL line TOGETHER WITH the indented `-> ...` detail that follows it.
  // Filtering on the FAIL prefix alone threw the detail away, and the detail is the only
  // part that says WHICH screen or value failed: a11y-names once failed here and the
  // report named nothing but the assertion, so it could not be diagnosed from the output
  // and had to be re-run by hand.
  const lines = out.split('\n');
  const failures = [];
  lines.forEach((l, i) => {
    if (!(l.startsWith('FAIL') || l.includes('  FAILED: '))) return;
    failures.push(l);
    for (let j = i + 1; j < lines.length && lines[j].trimStart().startsWith('-> '); j += 1) {
      failures.push(lines[j]);
    }
  });
  if (tally) {
    const [, total, passed, failed, skippedRaw] = tally;
    const skipped = Number(skippedRaw ?? 0);
    rows.push({ script, total: Number(total), passed: Number(passed), failed: Number(failed), skipped });
    console.log(
      `  ${passed}/${total} passed${Number(failed) ? `, ${failed} FAILED` : ''}` +
        (skipped ? `, ${skipped} skipped` : ''),
    );
    failures.forEach((f) => console.log('  ' + f.trim()));
  } else {
    // The script died before printing its own tally. It reports results line by line as
    // it goes, so salvage those rather than recording 0/0 — which erased thirteen passing
    // checks once and made a crashed script indistinguishable, in the summary table, from
    // an area with nothing to report.
    const lines = out.split('\n');
    const passed = lines.filter((l) => l.startsWith('PASS')).length;
    const failed = lines.filter((l) => l.startsWith('FAIL')).length;
    rows.push({
      script,
      total: passed + failed,
      passed,
      failed: failed || 1,   // a crash is a failure even if every check it reached passed
      partial: true,
    });
    console.log(`  !! CRASHED before finishing (exit ${code}) — ${passed} passed, ${failed} failed before it died`);
    failures.forEach((f) => console.log('  ' + f.trim()));
    console.log(`  last output:`);
    console.log(lines.slice(-12).map((l) => '  ' + l).join('\n'));
  }
}

const t = rows.reduce(
  (a, r) => ({
    total: a.total + r.total,
    passed: a.passed + r.passed,
    failed: a.failed + r.failed,
    skipped: a.skipped + (r.skipped ?? 0),
  }),
  { total: 0, passed: 0, failed: 0, skipped: 0 },
);
console.log(`\n${'#'.repeat(72)}`);
// Skips are reported, not swallowed: a rate-limited check that never ran used to
// shrink the total instead of showing up, so the suite read 196/196 while three
// behaviours went unexercised.
console.log(
  `REGRESSION SUITE: ${t.passed}/${t.total} checks passed, ${t.failed} failed` +
    (t.skipped ? `, ${t.skipped} SKIPPED (not run)` : ''),
);
for (const r of rows) {
  console.log(
    `  ${r.failed ? 'FAIL' : 'ok  '}  ${r.script.padEnd(26)} ${r.passed}/${r.total}` +
    (r.partial ? ' (PARTIAL — crashed before finishing)' : '') +
      (r.skipped ? `  (+${r.skipped} skipped)` : ''),
  );
}
process.exit(t.failed ? 1 : 0);
