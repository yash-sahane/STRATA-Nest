'use client';

import * as React from 'react';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useCreateProject } from '@/hooks/use-project';
import { useAuth } from '@/components/providers/auth-provider';
import type { ProjectMethodology } from '@/types';
import { DatePicker } from '@/components/ui/date-picker';

interface CreateProjectDialogProps {
  workspaceId: string;
}

export function CreateProjectDialog({ workspaceId }: CreateProjectDialogProps) {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [clientName, setClientName] = React.useState(''); // ✅ NEW: Client name field
  const [methodology, setMethodology] = React.useState<ProjectMethodology>('SCRUM');
  const [startDate, setStartDate] = React.useState<Date | undefined>(new Date());
  const [endDate, setEndDate] = React.useState<Date | undefined>();

  const createProject = useCreateProject();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    await createProject.mutateAsync({
      workspaceId,
      name,
      description,
      clientName, // ✅ NEW: Include client name
      methodology,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
      ownerId: user.id,
    });

    setName('');
    setDescription('');
    setClientName(''); // ✅ NEW: Reset client name
    setMethodology('SCRUM');
    setStartDate(new Date());
    setEndDate(undefined);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create Project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Set up a new project with Scrum methodology.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                placeholder="My Awesome Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                A unique project code will be auto-generated from the name.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="clientName">Client Name *</Label>
              <Input
                id="clientName"
                placeholder="Client or stakeholder name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                This will be automatically used in requirements created for this project.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="methodology">Methodology</Label>
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50">
                <div className="flex flex-col flex-1">
                  <span className="font-medium">Scrum</span>
                  <span className="text-xs text-muted-foreground">
                    Sprint-based iterative development
                  </span>
                </div>
                <Badge variant="secondary" className="shrink-0">Default</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Start Date</Label>
                <DatePicker
                  date={startDate}
                  onSelect={setStartDate}
                  placeholder="Pick a date"
                  buttonClassName="w-full"
                />
              </div>

              <div className="grid gap-2">
                <Label>End Date (Optional)</Label>
                <DatePicker
                  date={endDate}
                  onSelect={setEndDate}
                  placeholder="Pick a date"
                  disabled={(date: Date) => startDate ? date < startDate : false}
                  buttonClassName="w-full"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
