'use client';

import { useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDateOnly, parseDateOnly } from '@/lib/utils/working-days';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateEpic } from '@/hooks/use-epic';
import { useClientRequirements } from '@/hooks/use-client-requirement';

const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    description: z.string().max(1000).optional(),
    requirementId: z.string().optional(), // ✅ NEW: Map to requirement
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
    // Both are `yyyy-MM-dd` strings (the pickers write that form), so a lexical
    // comparison is a date comparison. Without this an epic saves end-before-start.
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });

type FormData = z.infer<typeof formSchema>;

interface CreateEpicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCode: string;
  workspaceId: string;
  /** The client requirement it is raised from, when it is raised from one. */
  defaultRequirementId?: string;
}

export function CreateEpicDialog({
  open,
  onOpenChange,
  defaultRequirementId = '',
  projectId,
  projectCode,
  workspaceId,
}: CreateEpicDialogProps) {
  const createEpic = useCreateEpic();
  const { data: requirements = [] } = useClientRequirements(projectId); // ✅ NEW: Load requirements for mapping

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      requirementId: '', // ✅ NEW: Default requirement selection
      startDate: '',
      endDate: '',
    },
  });

  useEffect(() => {
    if (open && defaultRequirementId) form.setValue('requirementId', defaultRequirementId);
  }, [open, defaultRequirementId, form]);

  const onSubmit = async (values: FormData) => {
    try {
      await createEpic.mutateAsync({
        projectId,
        projectCode,
        workspaceId,
        name: values.name.trim(),
        description: values.description || '',
        requirementId: values.requirementId || undefined, // ✅ NEW: Pass requirement mapping
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
      });
    } catch {
      // The mutation hook already toasted; keep the dialog open with the input
      // instead of letting the rejection escape react-hook-form's handleSubmit.
      return;
    }

    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape, the X and an outside click all arrive here and NOT through the
        // Cancel button, which was the only path that reset the form — so the next
        // open showed abandoned input and its stale validation error.
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Epic</DialogTitle>
          <DialogDescription>
            An epic is a feature that delivers a client requirement; its functional
            requirements are the pieces it is built and planned in.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name */}
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

            {/* Description */}
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

            {/* Requirement Mapping */}
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
                          {req.title}
                          {req.clientName ? ` · ${req.clientName}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Map this epic to a specific client requirement
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Dates */}
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      {/* The app's own picker: the browser's date input looked and
                          behaved differently in every browser, beside fields that
                          used this one. The form still holds 'yyyy-MM-dd'. */}
                      <DatePicker
                        date={field.value ? parseDateOnly(field.value) : undefined}
                        onSelect={(day) => field.onChange(day ? formatDateOnly(day) : '')}
                        placeholder="Pick a start date"
                      />
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
                      <DatePicker
                        date={field.value ? parseDateOnly(field.value) : undefined}
                        onSelect={(day) => field.onChange(day ? formatDateOnly(day) : '')}
                        // Not before the start — the rule the schema enforces on save.
                        disabled={(day) => {
                          // Read when the calendar draws its days, so it is the start as it is now.
                          const start = form.getValues('startDate');
                          return !!start && formatDateOnly(day) < start;
                        }}
                        placeholder="Pick a target end date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Actions */}
            <DialogFooter className="pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  form.reset();
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createEpic.isPending}>
                {createEpic.isPending ? 'Creating...' : 'Create Epic'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
