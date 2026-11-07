'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

/** The two things a picker shows of a project. */
interface PickableProject {
  id: string;
  name: string;
  shortCode?: string | null;
  status?: string;
}

/**
 * The project selector at the top of every page that works inside one project.
 *
 * Five pages each drew their own: three listed "CODE - Name", one the name
 * alone, one the code in a different face; the empty state read "Select a
 * project...", "Select project" or "Select a project" depending on where you
 * were. It is one control, so it is one component — the choice it holds is
 * already shared between those pages, which made the differences look like
 * different things.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
  className,
  id,
}: {
  projects: readonly PickableProject[];
  /** The selected project's id, or '' while none is. */
  value: string;
  onChange: (projectId: string) => void;
  /** Sizing only — each page decides how wide its picker is. */
  className?: string;
  id?: string;
}) {
  const canCreateProject = useHasPermission(Permission.CREATE_PROJECT);
  // An archived project is not offered for new work. It stays in the list only
  // while it is the one open (a link to it, or the one already chosen).
  const offered = projects.filter((project) => project.status !== 'ARCHIVED' || project.id === value);
  // Every page that works inside a project starts here; with none to pick, the
  // picker opened onto nothing and the page's New button sat greyed out with no
  // word of why.
  if (projects.length === 0) {
    return (
      <div className={cn('flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm', className)}>
        <span className="text-muted-foreground">This workspace has no projects yet — everything here belongs to one.</span>
        {canCreateProject && (
          <Button asChild size="sm" variant="outline">
            <Link href="/projects?action=create">Create a project</Link>
          </Button>
        )}
      </div>
    );
  }
  if (offered.length === 0) {
    return (
      <div className={cn('flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm', className)}>
        <span className="text-muted-foreground">Every project in this workspace is archived.</span>
        <Button asChild size="sm" variant="outline">
          <Link href="/projects">See projects</Link>
        </Button>
      </div>
    );
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label="Select a project" className={cn('w-full', className)}>
        <SelectValue placeholder="Select a project" />
      </SelectTrigger>
      <SelectContent>
        {offered.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <span className="flex min-w-0 items-center gap-2">
              {project.shortCode && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {project.shortCode}
                </span>
              )}
              <span className="truncate" title={project.name}>{project.name}</span>
              {project.status === 'ARCHIVED' && (
                <span className="shrink-0 text-xs text-muted-foreground">Archived</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
