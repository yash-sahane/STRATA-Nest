import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { UploadedFile, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { StorageService } from '../storage/storage.service';
import type { CreateFileDto } from './dto';
import { uploadedFileResponse } from './mappers';

/** The subset of a Multer file this service needs (avoids an @types/multer dep). */
export interface UploadPart {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
  size?: number;
}

const SPEC: ListQuerySpec = {
  filterable: {
    workspaceId: { field: 'workspaceId' },
    projectId: { field: 'projectId' },
    bucketId: { field: 'bucket' },
  },
  sortable: { createdAt: 'createdAt', name: 'name' },
  defaultOrderBy: { createdAt: 'desc' },
};

/**
 * Files. Membership-scoped — a member sees files in their ACTIVE workspaces
 * PLUS global files (empty workspaceId). Blobs go through StorageService; the
 * row only holds the storage key + metadata.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger('Files');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly storage: StorageService,
  ) {}

  private response(f: UploadedFile) {
    return uploadedFileResponse(f, this.storage.url(f.filePath));
  }

  /** Scope: workspace_id in memberships + "" (global); admin sees all. */
  private async scope(user: User): Promise<Record<string, unknown>> {
    const ids = await this.access.accessibleWorkspaceIds(user);
    if (ids === null) return {};
    return { workspaceId: { in: [...ids, ''] } };
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof uploadedFileResponse>>> {
    const scope = await this.scope(user);
    const parsed = parseListQuery(query, SPEC);
    const where = { AND: [scope, parsed.where] };
    const [rows, total] = await Promise.all([
      this.prisma.uploadedFile.findMany({
        where,
        orderBy: parsed.orderBy,
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.uploadedFile.count({ where }),
    ]);
    return paginate(rows.map((r) => this.response(r)), total, parsed.page, parsed.pageSize);
  }

  private async findScoped(user: User, id: string): Promise<UploadedFile> {
    const scope = await this.scope(user);
    const row = await this.prisma.uploadedFile.findFirst({ where: { AND: [scope, { id }] } });
    if (!row) throw new NotFoundException('Not found.');
    return row;
  }

  async retrieve(user: User, id: string) {
    return this.response(await this.findScoped(user, id));
  }

  /** Multipart upload → persist blob via StorageService, then the metadata row. */
  async create(user: User, part: UploadPart | undefined, dto: CreateFileDto) {
    if (!part) throw new BadRequestException("Missing 'file' in multipart body");
    const workspaceId = dto.workspaceId ?? dto.workspace_id ?? '';
    // `scope()` only constrains READS. The upload target came straight off the
    // request body and was never checked, so any authenticated user could plant
    // a blob in another tenant's workspace — or in the global bucket
    // (workspaceId ''), which `scope()` unions into EVERY user's file list.
    if (workspaceId) {
      await this.access.assertMember(user, workspaceId);
    } else if (!this.access.isPlatformAdmin(user)) {
      throw new ForbiddenException('Only administrators can upload global files.');
    }
    if (workspaceId) {
      await this.access.assertPermission(user, workspaceId, Permission.FileWrite);
    }
    // The id is generated HERE, never taken from the request.
    //
    // The storage key is uploads/{ws}/{id}/{filename}, and the blob used to be
    // written before the row was inserted — so re-posting a known id and
    // filename overwrote somebody else's file, and the 400 the duplicate insert
    // then produced hid the fact that the content had already been replaced and
    // the stored size no longer matched the served bytes.
    const id = generateId();
    const projectId = dto.projectId ?? dto.project_id ?? '';
    const name = part.originalname;
    const key = StorageService.key(workspaceId, id, name);
    const mimeType = part.mimetype ?? '';

    // Claim the row first; only then write the bytes. If the blob write fails
    // the row goes with it, rather than leaving metadata pointing at nothing.
    const row = await this.prisma.uploadedFile.create({
      data: {
        id,
        name,
        filePath: key,
        mimeType,
        size: BigInt(part.size ?? part.buffer.length),
        workspaceId,
        projectId,
        uploadedById: user.id,
        bucket: dto.bucketId || 'default',
      },
    });
    try {
      await this.storage.save(key, part.buffer, mimeType);
    } catch (err) {
      await this.prisma.uploadedFile.delete({ where: { id } }).catch(() => undefined);
      throw err;
    }
    return this.response(row);
  }

  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    await this.assertMayDelete(user, row);
    try {
      await this.storage.remove(row.filePath);
    } catch (err) {
      // A blob-delete failure is logged, not fatal — the metadata row is still removed below.
      this.logger.warn(`blob deletion failed for ${id}: ${(err as Error).message}`);
    }
    await this.prisma.uploadedFile.delete({ where: { id } });
  }

  /**
   * Deleting a file takes `file:write`, and deleting SOMEBODY ELSE'S also takes
   * the manager-level `project:update` — one member removing another's
   * attachment is a destructive act with no undo and no trace in the UI.
   */
  private async assertMayDelete(user: User, row: UploadedFile): Promise<void> {
    if (this.access.isPlatformAdmin(user)) return;
    if (!row.workspaceId) {
      throw new ForbiddenException('Only administrators can delete global files.');
    }
    await this.access.assertPermission(user, row.workspaceId, Permission.FileWrite);
    if (row.uploadedById === user.id) return;
    await this.access.assertPermission(user, row.workspaceId, Permission.ProjectUpdate);
  }

  /** For streaming endpoints: the scoped row + an open read stream. */
  async openStream(user: User, id: string) {
    const row = await this.findScoped(user, id);
    return { row, stream: this.storage.createReadStream(row.filePath) };
  }
}
