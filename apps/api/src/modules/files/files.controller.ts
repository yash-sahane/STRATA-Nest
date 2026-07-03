import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
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
 * download = attachment). Auth + membership scoping only, matching Django's
 * viewset (no role gate); blob IO is delegated to StorageService.
 */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly svc: FilesService) {}

  @Get() list(@CurrentUser() u: User, @Query() q: Q) { return this.svc.list(u, q); }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(@CurrentUser() u: User, @UploadedFile() file: UploadPart | undefined, @Body() d: CreateFileDto) {
    return this.svc.create(u, file, d);
  }

  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.retrieve(u, id); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.remove(u, id); }

  @Get(':id/preview') preview(@CurrentUser() u: User, @Param('id') id: string) { return this.stream(u, id, false); }
  @Get(':id/view') view(@CurrentUser() u: User, @Param('id') id: string) { return this.stream(u, id, false); }
  @Get(':id/download') download(@CurrentUser() u: User, @Param('id') id: string) { return this.stream(u, id, true); }

  private async stream(u: User, id: string, asAttachment: boolean): Promise<StreamableFile> {
    const { row, stream } = await this.svc.openStream(u, id);
    const disposition = asAttachment ? 'attachment' : 'inline';
    return new StreamableFile(stream, {
      type: row.mimeType || 'application/octet-stream',
      disposition: `${disposition}; filename="${row.name}"`,
    });
  }
}
