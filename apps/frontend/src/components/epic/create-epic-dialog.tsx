'use client';

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

const formSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(1000).optional(),
  requirementId: z.string().optional(), // ✅ NEW: Map to requirement
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface CreateEpicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCode: string;
  workspaceId: string;
  userId: string;
}

export function CreateEpicDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
  workspaceId,
  userId,
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

  const onSubmit = async (values: FormData) => {
    await createEpic.mutateAsync({
      projectId,
      projectCode,
      workspaceId,
      createdBy: userId,
      name: values.name,
      description: values.description || '',
      requirementId: values.requirementId || undefined, // ✅ NEW: Pass requirement mapping
      startDate: values.startDate || undefined,
      endDate: values.endDate || undefined,
    });

    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Epic</DialogTitle>
          <DialogDescription>
            Create a new epic to group related user stories and features
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
                          {req.id} - {req.title}
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

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
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
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
