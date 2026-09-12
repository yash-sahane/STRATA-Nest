'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateClientRequirement } from '@/hooks/use-client-requirement';
import type { RequirementPriority } from '@/types';

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  clientName: z.string().min(1, 'Client name is required'),
});

type FormData = z.infer<typeof schema>;

interface CreateClientRequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  userId: string;
  clientName?: string; // ✅ NEW: Auto-populated from project
}

export function CreateClientRequirementDialog({
  open,
  onOpenChange,
  projectId,
  workspaceId,
  userId,
  clientName = '', // ✅ NEW: Default to empty string if not provided
}: CreateClientRequirementDialogProps) {
  const createRequirement = useCreateClientRequirement();
  const [priority, setPriority] = React.useState<RequirementPriority>('MEDIUM');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      clientName: '',
    },
  });

  // Seed the form every time the dialog opens, not only when the prop changes.
  // A bare reset() restores defaultValues (clientName: ''), which left the
  // auto-filled — and therefore disabled — Client Name field empty and the
  // dialog permanently unsubmittable after the first successful create.
  React.useEffect(() => {
    if (!open) return;
    reset({ title: '', description: '', clientName });
    setPriority('MEDIUM');
  }, [open, clientName, reset]);

  const onSubmit = async (data: FormData) => {
    try {
      await createRequirement.mutateAsync({
        workspaceId,
        projectId,
        title: data.title,
        description: data.description,
        clientName: data.clientName,
        priority: priority,
        createdBy: userId,
      });
    } catch {
      // The mutation's onError already toasted. Swallow the rejection so it does
      // not escape react-hook-form's handleSubmit as an unhandled rejection.
      return;
    }

    reset({ title: '', description: '', clientName });
    setPriority('MEDIUM');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Client Requirement</DialogTitle>
          <DialogDescription>
            Capture requirements from client discussions and meetings
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              {...register('title')}
              placeholder="E.g., User Authentication System"
            />
            {errors.title && (
              <p className="text-sm text-destructive-text">{errors.title.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientName">Client Name *</Label>
            <Input
              id="clientName"
              {...register('clientName')}
              placeholder="E.g., John Doe, ABC Corporation"
              disabled={!!clientName}
              className={clientName ? 'bg-muted cursor-not-allowed' : ''}
            />
            {clientName && (
              <p className="text-xs text-muted-foreground">
                ✓ Auto-filled from project settings
              </p>
            )}
            {errors.clientName && (
              <p className="text-sm text-destructive-text">{errors.clientName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority *</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as RequirementPriority)}>
              <SelectTrigger id="priority">
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

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="Describe the requirement in detail..."
              className="min-h-[150px]"
            />
            {errors.description && (
              <p className="text-sm text-destructive-text">{errors.description.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Requirement'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
