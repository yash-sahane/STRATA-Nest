import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Header,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateFileDto } from './dto';
import { FilesService, type UploadPart } from './files.service';

type Q = Record<string, string | string[] | undefined>;

/**
 * Files: multipart upload + CRUD + streaming (preview/view = inline,
 * download = attachment). Auth + membership scoping only (no role gate);
 * blob IO is delegated to StorageService.
 */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly svc: FilesService) {}

  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }

  @Post()
  // An explicit ceiling: without one an upload is bounded only by available
  // memory, and multer's own rejection is a clean 413 through the filter.
  //
  // 20 MB is the number the browser already checks against
  // (MAX_UPLOAD_BYTES in apps/frontend/src/hooks/use-file.ts) so it can warn
  // before pushing the body over the wire. Two different limits would mean a
  // file the client accepted and the server refused, with the user told two
  // different rules — so this is deliberately the SAME number.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  create(@CurrentUser() u: User, @UploadedFile() file: UploadPart | undefined, @Body() d: CreateFileDto) {
    return this.svc.create(u, file, d);
  }

  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }

  @Get(':id/preview') @Header('X-Content-Type-Options', 'nosniff')
  preview(@CurrentUser() u: User, @Param('id') id: string) { return this.stream(u, id, false); }

  @Get(':id/view') @Header('X-Content-Type-Options', 'nosniff')
  view(@CurrentUser() u: User, @Param('id') id: string) { return this.stream(u, id, false); }

  @Get(':id/download') @Header('X-Content-Type-Options', 'nosniff')
  download(@CurrentUser() u: User, @Param('id') id: string) { return this.stream(u, id, true); }

  /**
   * Types that may be rendered IN the browser on this origin.
   *
   * An allow-list, not a block-list. Uploads were previously streamed back
   * `inline` under their own declared type, so an .svg or .html containing a
   * <script> ran as script on the API origin — the origin that holds the
   * session cookie. Anything not on this list is forced to download instead,
   * which makes an uploaded file inert however it is labelled.
   */
  private static readonly INLINE_SAFE = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
    'application/pdf', 'text/plain', 'text/csv',
  ]);

  /** Header-safe filename. A name containing a quote, newline or non-ASCII
   *  character would otherwise corrupt (or inject into) Content-Disposition. */
  private static dispositionFor(kind: 'inline' | 'attachment', name: string): string {
    // Strip anything outside printable ASCII, then the characters that would
    // terminate or inject into the header: quote, backslash, CR, LF.
    const ascii = String(name || 'file').replace(new RegExp('[^\x20-\x7E]', 'g'), '_');
    const fallback = ascii.replace(new RegExp('["\\\r\n]', 'g'), '_');
    return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name || 'file')}`;
  }

  private async stream(u: User, id: string, asAttachment: boolean): Promise<StreamableFile> {
    const { row, stream } = await this.svc.openStream(u, id);
    const declared = (row.mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const renderable = FilesController.INLINE_SAFE.has(declared);
    const kind = asAttachment || !renderable ? 'attachment' : 'inline';
    return new StreamableFile(stream, {
      // Only hand back the declared type for types we are willing to render;
      // everything else is served as an opaque download.
      type: renderable ? declared : 'application/octet-stream',
      disposition: FilesController.dispositionFor(kind, row.name),
    });
  }
}
