/**
 * The text of a parsed PDF, in its lines and paragraphs.
 *
 * pdf2json hands back positioned pieces of text, not lines. The parse route used
 * to join every piece on a page with a space and break only between pages, so a
 * numbered requirements list reached the generator as one run-on line ("…pay by
 * card. 3. Customers receive…") and the model had to guess where one requirement
 * ended and the next began.
 *
 * Here, pieces that share a baseline make one line. A gap clearly taller than the
 * page's usual line spacing is a paragraph break, and pages are separated by a
 * blank line.
 */

/** The slice of pdf2json's output this reads. */
interface PdfTextItem {
  y: number;
  R?: Array<{ T?: string }>;
}
interface PdfPage {
  Texts?: PdfTextItem[];
}

/** Baselines closer than this are one line (pdf2json units; a 12pt line is ~0.875). */
const SAME_LINE = 0.25;
/** A gap this many times the usual line spacing is a paragraph break. */
const PARAGRAPH = 1.5;

export function pdfText(parsed: { Pages?: PdfPage[] } | null | undefined): string {
  return (parsed?.Pages ?? []).map(pageText).filter(Boolean).join('\n\n').trim();
}

function decode(raw: string): string {
  // A stray '%' in the source makes decodeURIComponent throw a URIError, which
  // used to fail the whole document over one glyph.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function pageText(page: PdfPage): string {
  const lines: Array<{ y: number; text: string }> = [];
  for (const item of page.Texts ?? []) {
    // Runs inside one piece are style changes within the same words: no space.
    const piece = (item.R ?? []).map((r) => (r.T ? decode(r.T) : '')).join('');
    if (!piece.trim()) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(item.y - last.y) < SAME_LINE) {
      last.text += /\s$/.test(last.text) || /^\s/.test(piece) ? piece : ` ${piece}`;
    } else {
      lines.push({ y: item.y, text: piece });
    }
  }
  if (!lines.length) return '';

  const gaps = lines
    .slice(1)
    .map((line, i) => line.y - lines[i].y)
    .filter((gap) => gap > SAME_LINE);
  const usual = median(gaps);

  return lines
    .map((line, i) => {
      const text = line.text.replace(/\s+/g, ' ').trim();
      if (i === 0 || !usual) return text;
      // Only a gap DOWN the page counts; moving up means a new column.
      const gap = line.y - lines[i - 1].y;
      return gap > usual * PARAGRAPH ? `\n${text}` : text;
    })
    .join('\n');
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
