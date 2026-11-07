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
import {
  useCreateFunctionalRequirement,
  useUpdateFunctionalRequirement,
} from '@/hooks/use-functional-requirement';
import { basedOnFor, changedFields } from '@/lib/utils/changed-fields';
import type { ClientRequirement, EditBasedOn, FunctionalRequirement, Epic } from '@/types';

const formSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(['FUNCTIONAL', 'NON_FUNCTIONAL', 'TECHNICAL', 'BUSINESS']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']),
  epicId: z.string().min(1, 'Epic is required'), // ✅ FIXED: Epic is mandatory
  parentRequirementId: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface CreateFunctionalRequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCode: string;
  workspaceId: string;
  clientRequirements: ClientRequirement[];
  functionalRequirements: FunctionalRequirement[];
  epics: Epic[]; // ✅ NEW: Epics for mapping
  /**
   * Present: edit THIS requirement instead of creating one.
   *
   * There was no way to. Once created, a requirement's title, description,
   * type, priority, complexity, epic and parent were fixed — the detail dialog
   * writes only its sprint and assignees — so a typo or a wrong epic meant
   * deleting it and starting again, which also cut its tasks loose.
   */
  requirement?: FunctionalRequirement | null;
  /** The epic a new requirement is added to, when it is added from one. */
  defaultEpicId?: string;
}

/** The form's fields as a requirement holds them, or the blanks of a new one. */
const valuesFor = (requirement?: FunctionalRequirement | null): FormData => ({
  title: requirement?.title ?? '',
  description: requirement?.description ?? '',
  type: (requirement?.type as FormData['type']) ?? 'FUNCTIONAL',
  // '' is what an AI-generated requirement carries: shown as Medium, and only
  // written back if the person actually changes it.
  priority: (requirement?.priority as FormData['priority']) || 'MEDIUM',
  complexity: (requirement?.complexity as FormData['complexity']) ?? 'MEDIUM',
  epicId: requirement?.epicId ?? '',
  parentRequirementId: requirement?.parentRequirementId ?? '',
});

export function CreateFunctionalRequirementDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
  workspaceId,
  functionalRequirements,
  epics, // ✅ NEW: Receive epics
  requirement = null,
  defaultEpicId = '',
}: CreateFunctionalRequirementDialogProps) {
  const createRequirement = useCreateFunctionalRequirement();
  const updateRequirement = useUpdateFunctionalRequirement();
  const editing = requirement;
  const saving = createRequirement.isPending || updateRequirement.isPending;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: valuesFor(null),
  });

  // What the requirement held when THIS dialog opened: the baseline both the
  // diff and the conflict check are taken against. Seeded once per opening, by
  // id — the row itself is refetched whenever anybody touches it, and re-seeding
  // on that would wipe what was being typed and move the baseline under it.
  const baseline = React.useRef<FunctionalRequirement | null>(null);
  const seededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }
    const key = editing?.id ?? 'new';
    if (seededFor.current === key) return;
    seededFor.current = key;
    baseline.current = editing;
    form.reset(editing ? valuesFor(editing) : { ...valuesFor(null), epicId: defaultEpicId });
  }, [open, editing, form, defaultEpicId]);

  const saveEdit = async (values: FormData): Promise<boolean> => {
    const original = baseline.current;
    if (!original) return false;
    const before = valuesFor(original);
    const submitted: Record<string, unknown> = {
      title: values.title.trim(),
      description: values.description ?? '',
      type: values.type,
      priority: values.priority,
      complexity: values.complexity,
      epicId: values.epicId,
      parentRequirementId: values.parentRequirementId || '',
    };
    // Compared against what the FORM showed, so a field left alone is not sent.
    const shown: Record<string, unknown> = {
      title: before.title,
      description: before.description ?? '',
      type: before.type,
      priority: before.priority,
      complexity: before.complexity,
      epicId: before.epicId,
      parentRequirementId: before.parentRequirementId || '',
    };
    const updates = changedFields(shown, submitted);
    // A requirement belongs to the client requirement its epic does. It was
    // copied from the epic once, at creation, and nothing kept it in step.
    if (updates.epicId !== undefined) {
      updates.clientRequirementId =
        epics.find((epic) => epic.id === values.epicId)?.requirementId || '';
    }
    if (Object.keys(updates).length === 0) return true;
    await updateRequirement.mutateAsync({
      requirementId: original.id,
      projectId,
      updates: {
        ...updates,
        basedOn: basedOnFor(original as unknown as Record<string, unknown>, updates),
      } as EditBasedOn<Partial<FunctionalRequirement>>,
    });
    return true;
  };

  const onSubmit = async (values: FormData) => {
    if (editing) {
      try {
        if (await saveEdit(values)) onOpenChange(false);
      } catch {
        // The mutation toasts the reason (a conflict names the field); the form
        // stays open with everything the person typed.
      }
      return;
    }

    // ✅ FIX: Get client requirement id from the selected epic's requirementId
    const selectedEpic = epics.find((e) => e.id === values.epicId);
    const clientReqId = selectedEpic?.requirementId || '';

    try {
      await createRequirement.mutateAsync({
        projectId,
        projectCode,
        workspaceId,
        title: values.title,
        description: values.description || '',
        type: values.type,
        priority: values.priority,
        complexity: values.complexity,
        status: 'DRAFT',
        epicId: values.epicId, // ✅ FIXED: Epic is now mandatory
        clientRequirementId: clientReqId, // ✅ FIX: Derived from epic's linked client requirement
        parentRequirementId: values.parentRequirementId, // For sub-requirements
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
  const parentRequirements = functionalRequirements.filter(
    // ...and never the requirement being edited: it cannot be its own parent.
    (fr) => !fr.parentRequirementId && fr.id !== editing?.id
  );

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
          <DialogTitle>
            {editing ? 'Edit Functional Requirement' : 'Create Functional Requirement'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? `${editing.hierarchyId} — change what it says and where it sits. Its sprint and assignees are set on the requirement itself.`
              : 'What the team will build to meet a client requirement. Tasks are created from it.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          {/* Wrapped so the handler is built when the form is submitted, not on
              every render: saving an edit reads the baseline ref. */}
          <form onSubmit={(event) => form.handleSubmit(onSubmit)(event)} className="space-y-4">
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
              <Button type="submit" disabled={saving || epics.length === 0}>
                {editing
                  ? saving
                    ? 'Saving...'
                    : 'Save Changes'
                  : saving
                    ? 'Creating...'
                    : 'Create Functional Requirement'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
