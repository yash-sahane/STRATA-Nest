'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PageLoader } from '@/components/ui/page-loader';

import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useActivityLogsRealtime } from '@/hooks/use-realtime';
import { ActivityFeed } from '@/components/activity/activity-feed';
import { EmptyState } from '@/components/ui/empty-state';
import { Activity } from 'lucide-react';

/**
 * The audit trail is WORKSPACE-scoped: `ActivityLog` carries workspaceId,
 * userId, action, entityType and entityId, but no projectId (see
 * packages/prisma/schema — and ActivityLogsService's filter spec). The project
 * picker that used to sit here could therefore never narrow anything; it read as
 * a working control on a page that rendered a hardcoded empty array. It is gone
 * rather than left inert, along with the "No Projects Found" gate — workspace
 * activity exists (members joining, leave decisions) before any project does,
 * and blocking on projects hid it.
 */
export default function ActivityPage() {
  const { user } = useAuth();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();
  // Realtime: an audit feed that only updates on refresh defeats its own purpose.
  useActivityLogsRealtime(currentWorkspace?.id);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-muted-foreground">Please sign in to view activities.</p>
      </div>
    );
  }

  if (workspacesLoading) {
    return <PageLoader message="Loading activity..." />;
  }

  if (!currentWorkspace) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Activity}
          title="Activity"
          description="Track what's happening across your workspace"
        />
        <EmptyState
          icon={Activity}
          title="No workspace found"
          description="Create a workspace to start tracking activity."
        />
      </div>
    );
  }

  return (
    // No `container`/`py-6` here: the dashboard layout already wraps every route
    // in <PageContainer>, which owns the width and gutter (page-container.tsx) —
    // and no max-width on the feed either, which left it a narrower column than
    // the header above it and every other page.
    <div className="space-y-6">
      <PageHeader
        icon={Activity}
        title="Activity"
        description="Track what's happening across your workspace"
      />

      <ActivityFeed workspaceId={currentWorkspace.id} showFilters={true} />
    </div>
  );
}
