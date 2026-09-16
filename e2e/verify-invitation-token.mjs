// An e-mail invitation TOKEN had nowhere to be redeemed.
//
// POST /workspaces/accept-invitation takes either `token` (an EmailInvitation) or
// `code` (the workspace invite code), and the only UI posted `{ code }`
// unconditionally — so a token pasted into the one field was looked up as a code and
// answered "Invalid invite code".
//
// Both kinds are exercised here through the API, and the shape rule the client uses to
// tell them apart is asserted directly, because that rule is the fix.
import { api, adminJar, provision, addRole, getJar, whoami } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 300)}`); };

const admin = await adminJar();
const p = await provision('invtok');

// ---- the shape rule the client routes on ------------------------------------
// code   randomBytes(8).base64url.slice(0,10).toUpperCase()   <= 12 chars, uppercase
// token  randomBytes(24).base64url                            ~32 chars, mixed case
const looksLikeCode = (value) => {
  const v = value.trim();
  return /^[A-Z0-9_-]{1,12}$/.test(v.toUpperCase()) && v.length <= 12;
};

console.log('===== the shapes are distinguishable');
{
  const codeRow = await api(admin, 'POST', '/invite_codes', {
    workspaceId: p.ws, role: 'MEMBER', maxUses: 5,
  });
  const code = codeRow.j?.code;
  rec(Boolean(code), 'a real invite code was generated', `${codeRow.s} ${codeRow.t.slice(0, 180)}`);
  console.log(`   code=${JSON.stringify(code)} len=${String(code).length}`);
  rec(looksLikeCode(code), 'a real code is classified as a code', String(code));

  const invited = 'role.tester@strata.local';
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + 14);
  const invitation = await api(admin, 'POST', '/email_invitations', {
    workspaceId: p.ws, email: invited, role: 'MEMBER',
    expiresAt: expires.toISOString(),
  });
  const token = invitation.j?.token;
  console.log(`   token=${JSON.stringify(token)} len=${String(token).length}`);
  rec(Boolean(token), 'an email invitation exposes its token to the inviter',
    `${invitation.s} ${invitation.t.slice(0, 200)}`);
  rec(!looksLikeCode(String(token)),
    'and a real token is NOT classified as a code, so it is sent as a token',
    `${token} (len ${String(token).length})`);

  // ---- the token actually redeems ------------------------------------------
  const outsider = await getJar(invited, 'RolePass123!');
  const outsiderId = await whoami(outsider);
  const before = await api(outsider, 'GET', '/workspaces');
  rec(!(before.j?.items ?? []).some((w) => w.id === p.ws),
    'the invitee is not a member yet',
    JSON.stringify((before.j?.items ?? []).map((w) => w.id)));

  // As a CODE, which is what the UI used to send — this is the old failure.
  const asCode = await api(outsider, 'POST', '/workspaces/accept-invitation', { code: token });
  console.log(`   token sent as a code -> ${asCode.s} ${asCode.t.slice(0, 120)}`);
  rec(asCode.s === 400 && /invalid invite code/i.test(asCode.t),
    'sending a token as a code is refused AS A BAD CODE, which is what the UI used to do',
    `${asCode.s} ${asCode.t.slice(0, 200)}`);

  // As a TOKEN, which is what the shape rule now produces.
  const asToken = await api(outsider, 'POST', '/workspaces/accept-invitation', { token });
  console.log(`   token sent as a token -> ${asToken.s} ${asToken.t.slice(0, 160)}`);
  rec(asToken.s < 400 && asToken.j?.success,
    'sending it as a token joins the workspace',
    `${asToken.s} ${asToken.t.slice(0, 250)}`);
  rec(asToken.j?.workspaceId === p.ws, 'and the right workspace',
    String(asToken.j?.workspaceId));
  void outsiderId;
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
