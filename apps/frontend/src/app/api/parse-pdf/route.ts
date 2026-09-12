import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import PDFParser from 'pdf2json';
import { hasApiSession } from '@/lib/api/server-proxy';
import { logger } from '@/lib/logger';

/** Upload ceiling. The parse is CPU-bound and buffers the whole file in memory. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    // Nothing else authenticates this route — it parses locally instead of
    // proxying to the API — so an anonymous POST could pin a worker on an
    // arbitrarily nasty PDF.
    if (!(await hasApiSession(request))) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
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

    const parsedData = await new Promise<any>((resolve, reject) => {
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        // Tagged so the catch below can tell "this upload is unreadable" (the
        // caller's problem, 422) from an actual server fault (500). The magic-byte
        // check above only rejects non-PDFs; a real PDF that is truncated,
        // encrypted or corrupt reaches pdf2json and fails here.
        const err = new Error(String(errData?.parserError ?? 'Unreadable PDF'));
        (err as Error & { isParseFailure?: boolean }).isParseFailure = true;
        reject(err);
      });

      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        resolve(pdfData);
      });

      pdfParser.loadPDF(tempFilePath!);
    });

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

    // Clean up temp file
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => { });
    }

    const numPages = parsedData?.Pages?.length || 0;

    return NextResponse.json({
      text: fullText.trim(),
      pages: numPages,
      info: { pages: numPages },
    });
  } catch (error: any) {
    // Clean up temp file on error
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => { });
    }

    if (error?.isParseFailure) {
      logger.warn('PDF could not be parsed', { error: error.message });
      return NextResponse.json(
        {
          error:
            'Could not read this PDF. It may be damaged, encrypted, or password-protected — try re-exporting it.',
        },
        { status: 422 }
      );
    }

    logger.error('PDF parsing error', { error });
    return NextResponse.json(
      { error: 'Failed to parse PDF: ' + error.message },
      { status: 500 }
    );
  }
}
