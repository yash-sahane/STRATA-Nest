import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import { ProjectCloneService } from './project-clone.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [DeletionModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectCloneService],
})
export class ProjectsModule {}
