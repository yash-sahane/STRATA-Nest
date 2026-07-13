import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import PDFParser from 'pdf2json';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Convert file to buffer and write to temp file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create temp file path
    tempFilePath = join(tmpdir(), `pdf-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`);
    await writeFile(tempFilePath, buffer);

    // Parse PDF using pdf2json
    const pdfParser = new PDFParser();

    const parsedData = await new Promise<any>((resolve, reject) => {
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        reject(new Error(errData.parserError));
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
                  // Decode URI component (pdf2json encodes text)
                  const decodedText = decodeURIComponent(r.T);
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

    logger.error('PDF parsing error', { error });
    return NextResponse.json(
      { error: 'Failed to parse PDF: ' + error.message },
      { status: 500 }
    );
  }
}
