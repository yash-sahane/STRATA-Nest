// Does a file come back exactly as it went in?
//
// Attachments were probed thoroughly in an earlier pass — a dozen `fu-*` scripts covering
// limits, unicode names, overwrite, XSS. None of them is registered in the suite, and they
// no longer run at all: their fixtures directory is gone, so `fu-2-matrix` now dies with
// ENOENT. The suite's only file coverage is "uploads are inert when served back" and some
// DTO validation.
//
// So the one thing an attachment must actually do — survive the round trip byte for byte —
// is not verified by anything that still runs. This is that check, with the fixtures
// generated in-process so it cannot rot the same way.
//
// Bytes are compared by SHA-256 rather than length: a truncation at a block boundary, an
// encoding pass that mangles high bytes, or a stream that silently substitutes a
// placeholder all preserve plausible sizes.
import { createHash, randomBytes } from 'node:crypto';
import { api, adminJar, provision, addRole, API } from './kit.mjs';

const out = [];
const rec = (ok, n, d = '') => { out.push([ok, n]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n        -> ' + String(d).slice(0, 400)}`); };

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

const p = await provision('fileround');
const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
void (await adminJar());

/**
 * Fixtures built here, not read from disk.
 *
 * The previous upload suite kept its samples in a `fixtures/` directory that has since
 * disappeared, which is why those scripts now fail before asserting anything. Generated
 * content cannot go missing, and the awkward cases are more deliberate this way.
 */
const FIXTURES = [
  {
    name: 'plain.txt',
    type: 'text/plain',
    bytes: Buffer.from('The quick brown fox jumps over the lazy dog.\n'.repeat(40), 'utf8'),
    why: 'ordinary text',
  },
  {
    name: 'binary.bin',
    type: 'application/octet-stream',
    // Every byte value 0-255, repeated: catches an encoding pass that mangles high bytes
    // or trips on a NUL.
    bytes: Buffer.concat(Array.from({ length: 16 }, () => Buffer.from(Array.from({ length: 256 }, (_, i) => i)))),
    why: 'every byte value, including NUL and high bytes',
  },
  {
    name: 'random-512k.bin',
    type: 'application/octet-stream',
    // Big enough to cross stream chunk boundaries, where a truncation would hide.
    bytes: randomBytes(512 * 1024),
    why: '512KB, to cross stream chunk boundaries',
  },
  {
    name: 'ünïcödé — spec (v2).txt',
    type: 'text/plain',
    bytes: Buffer.from('Naïve façade — “quoted” … 日本語\n'.repeat(20), 'utf8'),
    why: 'a name with accents, an em dash, smart quotes and parentheses',
  },
];

const uploaded = [];

console.log('===== uploading');
for (const f of FIXTURES) {
  const form = new FormData();
  form.append('file', new Blob([f.bytes], { type: f.type }), f.name);
  form.append('workspaceId', p.ws);
  form.append('projectId', p.project);

  const r = await fetch(`${API}/files`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(mgr) },
    body: form,
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}

  console.log(`   ${f.name.padEnd(28)} ${f.bytes.length} bytes (${f.why}) -> ${r.status}`);
  rec(r.status === 200 || r.status === 201, `${f.name} uploads`, `${r.status} ${text.slice(0, 200)}`);
  if (body?.id) uploaded.push({ ...f, id: body.id, reported: body });
}

console.log('\n===== what the API says it stored');
for (const f of uploaded) {
  const sizeField = f.reported.sizeBytes ?? f.reported.size ?? f.reported.fileSize;
  console.log(`   ${f.name.padEnd(28)} id=${f.id} reportedSize=${sizeField} name=${JSON.stringify(f.reported.name ?? f.reported.fileName)}`);
  if (sizeField !== undefined) {
    rec(Number(sizeField) === f.bytes.length,
      `${f.name}: the stored size matches what was sent`,
      `sent ${f.bytes.length}, stored ${sizeField}`);
  }
}

console.log('\n===== downloading, and comparing the bytes');
for (const f of uploaded) {
  const r = await fetch(`${API}/files/${f.id}/download`, {
    headers: { Cookie: cookieHeader(mgr) },
  });
  rec(r.status === 200, `${f.name} downloads`, `${r.status}`);
  if (r.status !== 200) continue;

  const back = Buffer.from(await r.arrayBuffer());
  const sentHash = sha(f.bytes);
  const backHash = sha(back);
  console.log(`   ${f.name.padEnd(28)} sent ${f.bytes.length}B ${sentHash.slice(0, 16)}  back ${back.length}B ${backHash.slice(0, 16)}`);

  rec(back.length === f.bytes.length,
    `${f.name}: the same number of bytes comes back`,
    `sent ${f.bytes.length}, got ${back.length}`);
  rec(backHash === sentHash,
    `${f.name}: the bytes are identical, not merely the same length`,
    `sha256 sent ${sentHash}\n           sha256 back ${backHash}`);

  // The name must survive too — it is what the user sees when they save it.
  const cd = r.headers.get('content-disposition') || '';
  console.log(`   content-disposition: ${cd.slice(0, 120)}`);
  rec(/attachment/i.test(cd),
    `${f.name}: comes back as a download rather than something the browser renders`, cd);
  // filename* carries the real name percent-encoded; the ASCII fallback is sanitised.
  const encoded = encodeURIComponent(f.name);
  rec(cd.includes(encoded) || cd.includes(f.name),
    `${f.name}: the original filename survives the round trip`,
    `looked for ${encoded} in ${cd}`);
}

console.log('\n===== a file is not readable by someone outside the workspace');
{
  const outsider = await addRole(p.ws, 'MEMBER', 'role.member@strata.local');
  // A member of the workspace CAN read it — that is the control for the next assertion.
  const first = uploaded[0];
  if (first) {
    const asMember = await fetch(`${API}/files/${first.id}/download`, {
      headers: { Cookie: cookieHeader(outsider) },
    });
    rec(asMember.status === 200,
      'a workspace member can download an attachment (the control)',
      String(asMember.status));

    const anonymous = await fetch(`${API}/files/${first.id}/download`);
    rec(anonymous.status === 401 || anonymous.status === 403,
      'and an unauthenticated request cannot',
      `${anonymous.status} — an attachment must not be readable without a session`);
  }
}

await p.cleanup();
const bad = out.filter(([ok]) => !ok);
console.log(`\ntotal ${out.length}  passed ${out.length - bad.length}  failed ${bad.length}`);
bad.forEach(([, n]) => console.log('  FAILED: ' + n));
