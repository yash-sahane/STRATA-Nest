'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PageLoader } from '@/components/ui/page-loader';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { ActivityFeed } from '@/components/activity/activity-feed';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Activity } from 'lucide-react';

export default function ActivityPage() {
  const { user } = useAuth();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const { data: projects, isLoading: projectsLoading } = useProjects(
    currentWorkspace?.id || ''
  );

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');

  // Set first project as default
  React.useEffect(() => {
    if (projects && projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-muted-foreground">Please sign in to view activities.</p>
      </div>
    );
  }

  if (workspacesLoading || projectsLoading) {
    return <PageLoader message="Loading activity..." />;
  }

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
        <Activity className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-2xl font-semibold mb-2">No Workspace Found</h2>
        <p className="text-muted-foreground">Create a workspace to start tracking activities.</p>
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
        <Activity className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-2xl font-semibold mb-2">No Projects Found</h2>
        <p className="text-muted-foreground">Create a project to start tracking activities.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <PageHeader
        icon={Activity}
        title="Activity Feed"
        description="Track what's happening across your projects in real-time"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Project:</span>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Activity Feed */}
      {selectedProjectId && (
        <ActivityFeed
          projectId={selectedProjectId}
          showFilters={true}
          className="max-w-5xl mx-auto"
        />
      )}
    </div>
  );
}
