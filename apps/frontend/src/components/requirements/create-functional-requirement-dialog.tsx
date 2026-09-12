'use client';

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateFunctionalRequirement } from '@/hooks/use-functional-requirement';
import type { ClientRequirement, FunctionalRequirement, Epic } from '@/types'; // ✅ NEW: Import Epic type

const formSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(['FUNCTIONAL', 'NON_FUNCTIONAL', 'TECHNICAL', 'BUSINESS']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']),
  epicId: z.string().min(1, 'Epic is required'), // ✅ FIXED: Epic is mandatory
  parentRequirementId: z.string().optional(),
  isReusable: z.boolean().default(false),
});

type FormData = z.infer<typeof formSchema>;

interface CreateFunctionalRequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCode: string;
  workspaceId: string;
  userId: string;
  clientRequirements: ClientRequirement[];
  functionalRequirements: FunctionalRequirement[];
  epics: Epic[]; // ✅ NEW: Epics for mapping
}

export function CreateFunctionalRequirementDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
  workspaceId,
  userId,
  functionalRequirements,
  epics, // ✅ NEW: Receive epics
}: CreateFunctionalRequirementDialogProps) {
  const createRequirement = useCreateFunctionalRequirement();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
      type: 'FUNCTIONAL',
      priority: 'MEDIUM',
      complexity: 'MEDIUM',
      epicId: '',
      parentRequirementId: '',
      isReusable: false,
    },
  });

  const onSubmit = async (values: FormData) => {
    // ✅ FIX: Get client requirement id from the selected epic's requirementId
    const selectedEpic = epics.find((e) => e.id === values.epicId);
    const clientReqId = selectedEpic?.requirementId || '';

    try {
      await createRequirement.mutateAsync({
        projectId,
        projectCode,
        workspaceId,
        createdBy: userId,
        title: values.title,
        description: values.description || '',
        type: values.type,
        priority: values.priority,
        complexity: values.complexity,
        status: 'DRAFT',
        epicId: values.epicId, // ✅ FIXED: Epic is now mandatory
        clientRequirementId: clientReqId, // ✅ FIX: Derived from epic's linked client requirement
        parentRequirementId: values.parentRequirementId, // For sub-requirements
        reusable: values.isReusable || false,
      });
    } catch {
      // The mutation's onError already toasted. Swallow the rejection so it does
      // not escape react-hook-form's handleSubmit as an unhandled rejection.
      return;
    }

    form.reset();
    onOpenChange(false);
  };

  // A parent candidate is an FR that is itself top-level — i.e. one with no
  // parentRequirementId. The old predicate used clientRequirementId, which every
  // FR created through this dialog has, so the picker was always empty and
  // nesting was unreachable.
  const parentRequirements = functionalRequirements.filter((fr) => !fr.parentRequirementId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset(); // Cancel / X / Escape must not leave a half-filled form behind
        onOpenChange(next);
      }}
    >
      <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Functional Requirement</DialogTitle>
          <DialogDescription>
            Define technical specifications derived from client requirements
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="E.g., User Authentication API Endpoint" {...field} />
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
                      placeholder="Detailed description of the requirement..."
                      className="min-h-30"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Type and Priority */}
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="FUNCTIONAL">Functional</SelectItem>
                        <SelectItem value="NON_FUNCTIONAL">Non-Functional</SelectItem>
                        <SelectItem value="TECHNICAL">Technical</SelectItem>
                        <SelectItem value="BUSINESS">Business</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="CRITICAL">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Complexity */}
            <FormField
              control={form.control}
              name="complexity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Complexity *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="VERY_HIGH">Very High</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>Estimated implementation complexity</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Epic Mapping */}
            <FormField
              control={form.control}
              name="epicId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link to Epic *</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                    value={field.value || 'none'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an epic (required)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {epics.length === 0 ? (
                        <SelectItem value="none" disabled>
                          No epics available - create an epic first
                        </SelectItem>
                      ) : (
                        <>
                          <SelectItem value="none" disabled>
                            Select an epic...
                          </SelectItem>
                          {epics.map((epic) => (
                            <SelectItem key={epic.id} value={epic.id}>
                              {epic.hierarchyId} - {epic.name}
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {epics.length === 0
                      ? 'This project has no epics yet — create one first, otherwise this form cannot be submitted.'
                      : 'Functional requirements must be linked to an epic'}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Parent Requirement (for sub-requirements) */}
            <FormField
              control={form.control}
              name="parentRequirementId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent Requirement (Optional)</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                    value={field.value || 'none'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select parent requirement" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Top-level requirement</SelectItem>
                      {parentRequirements.map((fr) => (
                        <SelectItem key={fr.id} value={fr.id}>
                          {fr.hierarchyId} - {fr.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Create nested requirement under a parent (e.g., REQ-01.01)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Reusable Checkbox */}
            <FormField
              control={form.control}
              name="isReusable"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Reusable Requirement</FormLabel>
                    <FormDescription>
                      Mark as reusable to use across multiple projects
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

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
              <Button type="submit" disabled={createRequirement.isPending || epics.length === 0}>
                {createRequirement.isPending ? 'Creating...' : 'Create Requirement'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
