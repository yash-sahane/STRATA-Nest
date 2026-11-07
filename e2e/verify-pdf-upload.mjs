// The AI generator's PDF upload (POST /api/parse-pdf on the frontend), which no
// check had ever exercised.
//
// - A real PDF comes back as its text in its own lines and paragraphs. The route used
//   to join every piece of a page with a space, so a numbered requirements list
//   reached the model as one run-on line.
// - Who may use it: a manager can; a read-only member, an anonymous caller and a
//   request from another site cannot.
// - What it refuses: a file that is not a PDF (400) and a damaged one (422, with a
//   reason a person can act on), never a 500.
//
// The PDF is built here, with real xref offsets, rather than kept as a binary fixture.
import { provision, addRole, recorder, BASE } from './kit.mjs';

const { rec, summary } = recorder();

const LINES = [
  'Online Bookstore - Client Requirements',
  '',
  '1. Customers can search books by title, author and ISBN.',
  '2. Customers can add books to a cart and pay by card.',
  '3. Customers receive an e-mail receipt after paying.',
];

function buildPdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const text = ['BT', '/F1 12 Tf', '14 TL', '72 740 Td']
    .concat(lines.map((l, i) => (i === 0 ? `(${esc(l)}) Tj` : `T* (${esc(l)}) Tj`)))
    .concat(['ET']).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function upload(jar, ws, bytes, { name = 'requirements.pdf', headers = {} } = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
  const h = { ...headers };
  if (jar) h.Cookie = cookieHeader(jar);
  const url = `${BASE}/api/parse-pdf${ws ? `?workspaceId=${encodeURIComponent(ws)}` : ''}`;
  const r = await fetch(url, { method: 'POST', body: form, headers: h });
  let j = null;
  try { j = await r.json(); } catch {}
  return { s: r.status, j };
}

const p = await provision('pdf upload');
try {
  const mgr = await addRole(p.ws, 'MANAGER', 'role.manager@strata.local');
  const member = await addRole(p.ws, 'MEMBER', 'role.member@strata.local');
  const pdf = buildPdf(LINES);

  // ---------------------------------------------------------------- the text
  const ok = await upload(mgr, p.ws, pdf);
  rec(ok.s === 200, 'a manager uploads a PDF and gets its text back (200)', `${ok.s} ${JSON.stringify(ok.j).slice(0, 160)}`);
  const text = String(ok.j?.text ?? '');
  const lines = text.split('\n');
  rec(lines[0] === LINES[0], 'the title is a line of its own', JSON.stringify(lines.slice(0, 2)));
  rec(lines.includes(LINES[2]) && lines.includes(LINES[3]) && lines.includes(LINES[4]),
    'each numbered requirement is its own line, not one run-on sentence', JSON.stringify(text.slice(0, 220)));
  rec(lines.indexOf(LINES[3]) === lines.indexOf(LINES[2]) + 1, 'the requirements keep their order', JSON.stringify(lines));
  rec(/\n\n1\. Customers/.test(text), 'the blank line after the title survives as a paragraph break', JSON.stringify(text.slice(0, 90)));
  rec(ok.j?.pages === 1, 'the page count is reported', String(ok.j?.pages));

  // -------------------------------------------------------------- who may
  const asMember = await upload(member, p.ws, pdf);
  rec(asMember.s === 403, 'a read-only member is refused (403): reading a document only feeds generation', `${asMember.s} ${asMember.j?.error ?? ''}`);
  const anonymous = await upload(null, p.ws, pdf);
  rec(anonymous.s === 401, 'an anonymous upload is refused (401)', String(anonymous.s));
  const crossSite = await upload(mgr, p.ws, pdf, { headers: { Origin: 'https://evil.example' } });
  rec(crossSite.s === 403, 'an upload sent from another site is refused (403)', String(crossSite.s));

  // ----------------------------------------------------------- what it refuses
  const notPdf = await upload(mgr, p.ws, Buffer.from('just some text, not a PDF at all'), { name: 'notes.pdf' });
  rec(notPdf.s === 400, 'a file that is not a PDF is refused (400), not parsed', `${notPdf.s} ${notPdf.j?.error ?? ''}`);
  const damaged = await upload(mgr, p.ws, Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> broken beyond repair', 'latin1'));
  rec(damaged.s === 422 && /damaged|re-export|could not read/i.test(damaged.j?.error ?? ''),
    'a damaged PDF is answered 422 with something a person can act on', `${damaged.s} ${damaged.j?.error ?? ''}`);
  rec(![ok, asMember, anonymous, crossSite, notPdf, damaged].some((r) => r.s >= 500), 'no answer was a 5xx',
    [ok, asMember, anonymous, crossSite, notPdf, damaged].map((r) => r.s).join(','));
} finally {
  await p.cleanup();
}
summary();
