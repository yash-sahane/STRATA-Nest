'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateEpic } from '@/hooks/use-epic';
import { useClientRequirements } from '@/hooks/use-client-requirement';
import type { Epic } from '@/types';
import { changedFields } from '@/lib/utils/changed-fields';

/**
 * The same fields the create dialog owns — deliberately NOT status or progress.
 * Both are derived from the epic's tasks and rendered read-only in the detail
 * dialog ("Auto-calculated from tasks"), so offering them here would let someone
 * set a number that the very next screen recomputes and ignores.
 */
const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    description: z.string().max(1000).optional(),
    requirementId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });

type FormData = z.infer<typeof formSchema>;

interface EditEpicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  epic: Epic;
}

/** `yyyy-MM-dd` for <input type="date">; the API may return a full ISO string. */
const toDateInput = (value?: string) => (value ? String(value).slice(0, 10) : '');

export function EditEpicDialog({ open, onOpenChange, epic }: EditEpicDialogProps) {
  const updateEpic = useUpdateEpic();
  const { data: requirements = [] } = useClientRequirements(epic.projectId);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: epic.name,
      description: epic.description ?? '',
      requirementId: epic.requirementId ?? '',
      startDate: toDateInput(epic.startDate),
      endDate: toDateInput(epic.endDate),
    },
  });

  // The dialog is mounted once per row and reused, so the form has to re-seed
  // when a different epic is opened — otherwise it keeps the first one's values.
  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: epic.name,
      description: epic.description ?? '',
      requirementId: epic.requirementId ?? '',
      startDate: toDateInput(epic.startDate),
      endDate: toDateInput(epic.endDate),
    });
  }, [open, epic, form]);

  const onSubmit = async (values: FormData) => {
    try {
      const submitted = {
        name: values.name.trim(),
        description: values.description ?? '',
        requirementId: values.requirementId || '',
        // '' — never `undefined` — for an emptied date field. `undefined` is
        // dropped by JSON.stringify, so clearing a date sent no key at all:
        // the PATCH succeeded, the toast said so, and the epic kept the date
        // forever. The API maps '' to null (toDate in @strata/common), which
        // is how a date is actually removed.
        startDate: values.startDate ?? '',
        endDate: values.endDate ?? '',
      };
      // Only what changed. This form submits every field, and the API's update has no
      // version check — so a save used to carry values that were stale from the moment
      // the dialog opened and overwrite a concurrent edit to a field nobody here touched.
      // Diffed against `epic`, the snapshot this dialog was opened with.
      const updates = changedFields(
        epic as unknown as Record<string, unknown>,
        submitted as Record<string, unknown>,
      );
      if (Object.keys(updates).length === 0) {
        onOpenChange(false);
        return;
      }
      await updateEpic.mutateAsync({
        epicId: epic.id,
        projectId: epic.projectId,
        updates: updates as typeof submitted,
      });
    } catch {
      // The mutation toasts the reason; keep the dialog open with the input.
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Epic</DialogTitle>
          <DialogDescription>
            Update {epic.hierarchyId ? `${epic.hierarchyId} — ` : ''}
            {epic.name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="E.g., User Authentication System" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the epic's scope and objectives..."
                      className="min-h-25"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="requirementId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link to Requirement (Optional)</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                    value={field.value || 'none'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a requirement to map this epic to" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No requirement</SelectItem>
                      {requirements.map((req) => (
                        <SelectItem key={req.id} value={req.id}>
                          {req.id} - {req.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target End Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateEpic.isPending}>
                {updateEpic.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
