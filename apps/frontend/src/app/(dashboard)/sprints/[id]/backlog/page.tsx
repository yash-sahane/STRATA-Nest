'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import {
  useFunctionalRequirements,
  useFunctionalRequirementsBySprint,
  useUpdateFunctionalRequirement,
} from '@/hooks/use-functional-requirement';
import { useWorkspaceMembers } from '@/hooks/use-workspace';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Search,
  GripVertical,
  PlusCircle,
  ArrowUp,
  ArrowDown,
  FileText,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getPriorityConfig } from '@/components/tasks/priority-badge';
import { FRAssignmentCard } from '@/components/sprints/fr-assignment-card';
import { logger } from '@/lib/logger';

export default function SprintBacklogPage() {
  const params = useParams();
  const router = useRouter();
  const sprintId = params.id as string;

  const { data: sprint, isLoading: sprintLoading } = useSprint(sprintId);
  const { data: allTasks, isLoading: tasksLoading } = useTasks(sprint?.projectId);
  const { data: allFRs } = useFunctionalRequirements(sprint?.projectId);
  const { data: sprintFRs } = useFunctionalRequirementsBySprint(sprintId);
  const { data: workspaceMembers = [] } = useWorkspaceMembers(sprint?.workspaceId);
  const updateFR = useUpdateFunctionalRequirement();

  const [searchQuery, setSearchQuery] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
  const [sortMode, setSortMode] = React.useState<'manual' | 'priority' | 'created'>('manual');

  // Separate tasks into backlog and sprint
  const backlogTasks = React.useMemo(() => {
    if (!allTasks) return [];
    return allTasks.filter((task) => !task.sprintId || task.sprintId === '');
  }, [allTasks]);

  const sprintTasks = React.useMemo(() => {
    if (!allTasks || !sprintId) return [];
    return allTasks.filter((task) => task.sprintId === sprintId);
  }, [allTasks, sprintId]);

  // ✅ NEW: Separate FRs into backlog and sprint
  const backlogFRs = React.useMemo(() => {
    if (!allFRs) return [];
    return allFRs.filter((fr) => !fr.sprintId || fr.sprintId === '');
  }, [allFRs]);

  const assignedSprintFRs = React.useMemo(() => {
    return sprintFRs || [];
  }, [sprintFRs]);

  // Filter tasks
  const filteredBacklogTasks = React.useMemo(() => {
    let filtered = backlogTasks;

    if (searchQuery) {
      filtered = filtered.filter(
        (task) =>
          task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          task.hierarchyId.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (priorityFilter !== 'all') {
      filtered = filtered.filter((task) => task.priority === priorityFilter);
    }

    // Apply sorting
    if (sortMode === 'priority') {
      filtered = [...filtered].sort((a, b) => {
        const scoreA = getPriorityConfig(a.priority).score;
        const scoreB = getPriorityConfig(b.priority).score;
        return scoreB - scoreA; // Higher priority first
      });
    } else if (sortMode === 'created') {
      filtered = [...filtered].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else {
      // Manual order by position
      filtered = [...filtered].sort((a, b) => a.position - b.position);
    }

    return filtered;
  }, [backlogTasks, searchQuery, priorityFilter, sortMode]);

  // Sprint task counts (replaces removed story points / capacity fields)
  const totalSprintTasks = React.useMemo(() => sprintTasks.length, [sprintTasks]);
  const completedSprintTasks = React.useMemo(
    () => sprintTasks.filter((t) => t.status === 'DONE').length,
    [sprintTasks]
  );
  const capacityPercentage =
    totalSprintTasks > 0 ? Math.round((completedSprintTasks / totalSprintTasks) * 100) : 0;

  // ✅ NEW: Handle FR sprint assignment
  const handleAssignFRToSprint = async (frId: string) => {
    const fr = allFRs?.find((f) => f.id === frId);
    if (!fr) return;

    try {
      await updateFR.mutateAsync({
        requirementId: frId,
        projectId: fr.projectId,
        updates: { sprintId: sprintId },
      });

      toast({
        title: 'FR assigned to sprint',
        description: `${fr.hierarchyId} - ${fr.title}`,
      });
    } catch (error) {
      logger.error('Failed to assign FR to sprint', { error });
      toast({
        title: 'Error',
        description: 'Failed to assign FR to sprint',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveFRFromSprint = async (frId: string) => {
    const fr = allFRs?.find((f) => f.id === frId);
    if (!fr) return;

    try {
      await updateFR.mutateAsync({
        requirementId: frId,
        projectId: fr.projectId,
        updates: { sprintId: '' },
      });

      toast({
        title: 'FR removed from sprint',
        description: `${fr.hierarchyId} - ${fr.title}`,
      });
    } catch (error) {
      logger.error('Failed to remove FR from sprint', { error });
    }
  };

  if (sprintLoading || tasksLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <p className="text-muted-foreground">Loading sprint backlog...</p>
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <p className="text-muted-foreground mb-4">Sprint not found</p>
        <Button onClick={() => router.push('/sprints')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push('/sprints')} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{sprint.name}</h1>
            <p className="text-muted-foreground mt-1">
              Sprint Backlog - Manage sprint assignments and backlog priorities
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push(`/sprints/${sprintId}/board`)}>
              Open Board
            </Button>
            <Button variant="outline" onClick={() => router.push(`/sprints/${sprintId}/analytics`)}>
              View Analytics
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Filter by priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="CRITICAL">P1 - Critical</SelectItem>
            <SelectItem value="HIGH">P2 - High</SelectItem>
            <SelectItem value="MEDIUM">P3 - Medium</SelectItem>
            <SelectItem value="LOW">P4 - Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortMode} onValueChange={(val) => setSortMode(val as typeof sortMode)}>
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4" />
                <span>Manual Order</span>
              </div>
            </SelectItem>
            <SelectItem value="priority">
              <div className="flex items-center gap-2">
                <ArrowUp className="h-4 w-4" />
                <span>By Priority</span>
              </div>
            </SelectItem>
            <SelectItem value="created">
              <div className="flex items-center gap-2">
                <ArrowDown className="h-4 w-4" />
                <span>Recently Created</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sprint Capacity Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Sprint Capacity</span>
            <Badge variant={capacityPercentage > 100 ? 'destructive' : 'secondary'}>
              {completedSprintTasks} / {totalSprintTasks} tasks ({capacityPercentage}%)
            </Badge>
          </CardTitle>
          <CardDescription>
            {sprintTasks.length} tasks in sprint
            {capacityPercentage > 100 && (
              <span className="text-destructive ml-2">⚠ Over capacity!</span>
            )}
            {sortMode === 'manual' && (
              <span className="text-primary ml-2">• Drag to reorder backlog items</span>
            )}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* ✅ FRs Section - Only Sprint FRs and FR Backlog */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sprint FRs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Sprint FRs ({assignedSprintFRs.length})
            </CardTitle>
            <CardDescription>Functional requirements assigned to this sprint</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 min-h-100">
              {assignedSprintFRs.length > 0 ? (
                assignedSprintFRs.map((fr) => (
                  <div key={fr.id} className="relative">
                    <FRAssignmentCard
                      fr={fr}
                      teamMembers={workspaceMembers as any}
                      projectId={sprint.projectId}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => handleRemoveFRFromSprint(fr.id)}
                    >
                      Remove from Sprint
                    </Button>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-100 text-center p-4 bg-muted/30 rounded-lg border-2 border-dashed">
                  <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No FRs assigned to this sprint yet</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Drag or click FRs from the backlog to assign them
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Backlog FRs */}
        <Card>
          <CardHeader>
            <CardTitle>FR Backlog ({backlogFRs.length})</CardTitle>
            <CardDescription>Unassigned functional requirements</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 min-h-100">
              {backlogFRs.length > 0 ? (
                backlogFRs.map((fr) => (
                  <div key={fr.id} className="relative">
                    <FRAssignmentCard
                      fr={fr}
                      teamMembers={workspaceMembers as any}
                      projectId={sprint.projectId}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => handleAssignFRToSprint(fr.id)}
                    >
                      <PlusCircle className="h-4 w-4 mr-2" />
                      Add to Sprint
                    </Button>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-100 text-center p-4 bg-muted/30 rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No FRs in backlog</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Create functional requirements in your project first
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
