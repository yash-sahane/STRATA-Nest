'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Calendar, User, FileText, Trash2, CheckCircle2, Clock, Archive } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import {
  useClientRequirement,
  useUpdateClientRequirement,
  useDeleteClientRequirement,
} from '@/hooks/use-client-requirement';
import type { RequirementPriority, RequirementStatus } from '@/types';

const statusConfig: Record<
  RequirementStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
> = {
  DRAFT: { label: 'Draft', icon: FileText, variant: 'secondary' },
  SUBMITTED: { label: 'Submitted', icon: Clock, variant: 'default' },
  APPROVED: { label: 'Approved', icon: CheckCircle2, variant: 'default' },
  IN_PROGRESS: { label: 'In Progress', icon: Clock, variant: 'default' },
  COMPLETED: { label: 'Completed', icon: CheckCircle2, variant: 'default' },
  ARCHIVED: { label: 'Archived', icon: Archive, variant: 'secondary' },
};

const priorityConfig: Record<RequirementPriority, { label: string; color: string }> = {
  LOW: { label: 'Low', color: 'text-green-500' },
  MEDIUM: { label: 'Medium', color: 'text-yellow-500' },
  HIGH: { label: 'High', color: 'text-orange-500' },
  CRITICAL: { label: 'Critical', color: 'text-red-500' },
};

interface ClientRequirementDetailDialogProps {
  requirementId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function ClientRequirementDetailDialog({
  requirementId,
  open,
  onOpenChange,
  projectId,
  canEdit = true,
  canDelete = true,
}: ClientRequirementDetailDialogProps) {
  const { data: requirement } = useClientRequirement(requirementId || undefined);
  const updateRequirement = useUpdateClientRequirement();
  const deleteRequirement = useDeleteClientRequirement();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  // Local state for editing
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [status, setStatus] = React.useState<RequirementStatus>('DRAFT');
  const [priority, setPriority] = React.useState<RequirementPriority>('LOW');
  const [hasChanges, setHasChanges] = React.useState(false);
  const lastLoadedId = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (requirement) {
      const isNewRequirement = lastLoadedId.current !== requirement.id;

      if (isNewRequirement || !hasChanges) {
        setTitle(requirement.title);
        setDescription(requirement.description);
        setStatus(requirement.status);
        setPriority(requirement.priority);

        if (isNewRequirement) {
          setHasChanges(false);
          lastLoadedId.current = requirement.id;
        }
      }
    }
  }, [requirement, hasChanges]);

  if (!requirement) return null;

  const currentStatusConfig = statusConfig[status];
  const currentPriorityConfig = priorityConfig[priority];
  const StatusIcon = currentStatusConfig.icon;

  const handleSave = async () => {
    await updateRequirement.mutateAsync({
      requirementId: requirement.id,
      projectId,
      updates: {
        title,
        description,
        status,
        priority,
      },
    });
    setHasChanges(false);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    await deleteRequirement.mutateAsync({
      requirementId: requirement.id,
      projectId,
    });
    setDeleteDialogOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-4">
            <DialogTitle className="sr-only">Requirement Details</DialogTitle>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={currentStatusConfig.variant} className="flex items-center gap-1">
                    <StatusIcon className="h-3 w-3" />
                    {currentStatusConfig.label}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <span className={`text-lg ${currentPriorityConfig.color}`}>●</span>
                    <span className="text-sm text-muted-foreground">
                      {currentPriorityConfig.label} Priority
                    </span>
                  </div>
                </div>
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setHasChanges(true);
                  }}
                  className="text-xl font-semibold h-auto py-2"
                  placeholder="Requirement Title"
                  disabled={!canEdit}
                />
              </div>
            </div>
          </DialogHeader>

          <Separator className="my-4" />

          {/* Main Content */}
          <div className="space-y-6 py-2">
            {/* Client Info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <User className="h-4 w-4" />
                Client
              </div>
              <p className="text-base">{requirement.clientName}</p>
            </div>

            <Separator />

            {/* Description */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                Description
              </div>
              <Textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setHasChanges(true);
                }}
                className="min-h-[150px]"
                placeholder="Requirement Description"
                disabled={!canEdit}
              />
            </div>

            <Separator />

            {/* Status & Priority Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value as RequirementStatus);
                    setHasChanges(true);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="SUBMITTED">Submitted</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={priority}
                  onValueChange={(value) => {
                    setPriority(value as RequirementPriority);
                    setHasChanges(true);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Calendar className="h-4 w-4" />
                  Created
                </div>
                <p>{formatDate(requirement.createdAt)}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Calendar className="h-4 w-4" />
                  Last Updated
                </div>
                <p>{formatDate(requirement.updatedAt)}</p>
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            {canDelete ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {canEdit ? 'Cancel' : 'Close'}
              </Button>
              {canEdit && (
                <Button onClick={handleSave} disabled={!hasChanges}>
                  Save Changes
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client Requirement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{requirement.title}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
            <AlertDialogCancel className="mt-2 sm:mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
