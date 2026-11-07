import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import PDFParser, { type Output } from 'pdf2json';
import { checkWorkspacePermissions, hasApiSession } from '@/lib/api/server-proxy';
import { refuseCrossSite } from '@/lib/api/server-proxy';
import { GENERATION_PERMISSIONS, MAX_PDF_BYTES } from '@/lib/ai-generator';
import { logger } from '@/lib/logger';

/**
 * How long one parse may take. pdf2json reports through two events, and a PDF
 * that fires neither left the request open forever — and, the clean-up being
 * after the await, its temp file on disk for good.
 */
const PARSE_TIMEOUT_MS = 30_000;

/** Room for the multipart envelope around the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
    const refused = refuseCrossSite(request);
    if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  let tempFilePath: string | null = null;

  try {
    // Nothing else authenticates this route — it parses locally instead of
    // proxying to the API — so an anonymous POST could pin a worker on an
    // arbitrarily nasty PDF.
    if (!(await hasApiSession(request))) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    // And signed-in was not enough either: any member, a read-only one included,
    // could have this server parse PDFs of up to 20 MB on demand. The parse exists
    // only to feed AI generation, so it takes what generating takes
    // (GENERATION_PERMISSIONS) — checked from the query string, before the upload
    // is read at all.
    const access = await checkWorkspacePermissions(
      request,
      request.nextUrl.searchParams.get('workspaceId'),
      GENERATION_PERMISSIONS,
      'You do not have permission to generate a plan in this workspace, so documents cannot be read for one.',
    );
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    // A declared size over the limit is refused before the body is buffered.
    if (Number(request.headers.get('content-length')) > MAX_PDF_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json(
        { error: `PDF is too large (max ${MAX_PDF_BYTES / (1024 * 1024)}MB)` },
        { status: 413 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    // `formData.get` also returns plain strings; without the instanceof the
    // `.arrayBuffer()` below threw a raw TypeError and answered 500.
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF is too large (max ${MAX_PDF_BYTES / (1024 * 1024)}MB)` },
        { status: 413 }
      );
    }

    // Convert file to buffer and write to temp file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // pdf2json is fed a path, so reject anything that is not a PDF before it
    // touches the disk rather than after.
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ error: 'File is not a PDF' }, { status: 400 });
    }

    // Create temp file path
    tempFilePath = join(tmpdir(), `pdf-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`);
    await writeFile(tempFilePath, buffer);

    // Parse PDF using pdf2json
    const pdfParser = new PDFParser();

    let parseTimer: ReturnType<typeof setTimeout> | undefined;
    const parsedData = await new Promise<Output>((resolve, reject) => {
      // A PDF that never fires either event is answered as unreadable, and the
      // finally below still removes its temp file.
      parseTimer = setTimeout(() => {
        const err = new Error(`Parse did not finish within ${PARSE_TIMEOUT_MS / 1000}s`) as Error & {
          isParseFailure?: boolean;
          timedOut?: boolean;
        };
        err.isParseFailure = true;
        err.timedOut = true;
        reject(err);
      }, PARSE_TIMEOUT_MS);

      pdfParser.on('pdfParser_dataError', (errData) => {
        // Tagged so the catch below can tell "this upload is unreadable" (the
        // caller's problem, 422) from an actual server fault (500). The magic-byte
        // check above only rejects non-PDFs; a real PDF that is truncated,
        // encrypted or corrupt reaches pdf2json and fails here.
        const reason = errData instanceof Error ? undefined : errData?.parserError;
        const err = new Error(String(reason ?? 'Unreadable PDF'));
        (err as Error & { isParseFailure?: boolean }).isParseFailure = true;
        reject(err);
      });

      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        resolve(pdfData);
      });

      // Its promise was dropped: a failure to read the file was an unhandled rejection.
      Promise.resolve(pdfParser.loadPDF(tempFilePath!)).catch(reject);
    }).finally(() => clearTimeout(parseTimer));

    // Extract text from all pages
    let fullText = '';

    if (parsedData && parsedData.Pages) {
      for (const page of parsedData.Pages) {
        if (page.Texts) {
          for (const text of page.Texts) {
            if (text.R) {
              for (const r of text.R) {
                if (r.T) {
                  // Decode URI component (pdf2json encodes text). A stray '%'
                  // in the source makes decodeURIComponent throw a URIError,
                  // which used to fail the whole document over one glyph.
                  let decodedText: string;
                  try {
                    decodedText = decodeURIComponent(r.T);
                  } catch {
                    decodedText = r.T;
                  }
                  fullText += decodedText + ' ';
                }
              }
            }
          }
          fullText += '\n';
        }
      }
    }

    const numPages = parsedData?.Pages?.length || 0;

    return NextResponse.json({
      text: fullText.trim(),
      pages: numPages,
      info: { pages: numPages },
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error as Error & { isParseFailure?: boolean }).isParseFailure) {
      logger.warn('PDF could not be parsed', { error: error.message });
      return NextResponse.json(
        {
          error: (error as Error & { timedOut?: boolean }).timedOut
            ? 'This PDF took too long to read. Try a shorter document, or paste its text instead.'
            : 'Could not read this PDF. It may be damaged, encrypted, or password-protected — try re-exporting it.',
        },
        { status: 422 }
      );
    }

    logger.error('PDF parsing error', { error });
    return NextResponse.json(
      { error: 'Failed to parse PDF: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  } finally {
    // Every way out — success, refusal, failure, timeout — removes the temp file.
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => { });
    }
  }
}
