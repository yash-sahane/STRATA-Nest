'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/components/providers/auth-provider';
import { useCreateWorkspace } from '@/hooks/use-workspace';
import { Building2, Shield, AlertTriangle } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const createWorkspace = useCreateWorkspace();
  const isAdmin = user?.isAdmin === true;

  const [createForm, setCreateForm] = React.useState({
    name: '',
    description: '',
  });

  // No redirect effect for non-admins: WorkspaceGuard only sends admins here, so
  // the only way a non-admin lands on this route is by typing it, and bouncing
  // them silently hid the Access Denied card below — which explains WHY they
  // cannot proceed and offers the way back.

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createForm.name.trim()) {
      toast({
        title: 'Error',
        description: 'Workspace name is required',
        variant: 'destructive',
      });
      return;
    }

    if (!isAdmin) {
      toast({
        title: 'Error',
        description: 'Only administrators can create workspaces',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createWorkspace.mutateAsync({
        // Trimmed, matching the guard above. Submitting the raw value stored
        // "  Acme  " for a name the check had already normalised, and the API's
        // @IsNotEmpty accepts leading/trailing space.
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        ownerId: user?.id || '',
      });

      // Success/error toasts belong to the mutation — toasting again here
      // stacked two of each. A full document navigation (not router.push) so
      // every provider re-reads the freshly selected workspace on mount.
      window.location.href = '/dashboard';
    } catch {
      // error toast handled inside the mutation
    }
  };

  if (!user) {
    return <PageLoader className="min-h-screen bg-linear-to-br from-background to-muted" />;
  }

  // Non-admin error state
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-8 w-8 text-destructive-text" />
              </div>
              <h2 className="text-2xl font-bold">Access Denied</h2>
              <p className="text-muted-foreground">
                Only administrators can create workspaces. Please contact your administrator.
              </p>
              <Button onClick={() => router.push('/dashboard')} variant="outline">
                Go to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-4">
              <Building2 className="h-12 w-12 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl mb-2">Create Your Workspace</h1>
          <p className="text-muted-foreground">
            Set up your first workspace to start managing projects and teams
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-6">
            <Alert className="border-primary/50 bg-primary/5">
              <Shield className="h-4 w-4 text-primary" />
              <AlertDescription>
                <strong>Administrator Account Detected</strong>
                <p className="mt-1 text-sm">
                  As an admin, you can create workspaces and manage team members.
                </p>
              </AlertDescription>
            </Alert>

            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Workspace Name *</Label>
                <Input
                  id="workspace-name"
                  placeholder="e.g., Acme Corporation"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Choose a name that represents your organization or team
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="workspace-description">Description (Optional)</Label>
                <Textarea
                  id="workspace-description"
                  placeholder="Brief description of your workspace..."
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Help team members understand the purpose of this workspace
                </p>
              </div>

              <div className="rounded-lg border bg-muted/50 p-4">
                <h4 className="font-medium mb-2">What happens next?</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">1.</span>
                    Your workspace will be created instantly
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">2.</span>
                    You&apos;ll be redirected to the dashboard
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">3.</span>
                    You can add team members from the Team page
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">4.</span>
                    Start creating projects and managing tasks
                  </li>
                </ul>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={createWorkspace.isPending}
              >
                {createWorkspace.isPending ? (
                  <>
                    <Building2 className="mr-2 h-4 w-4 animate-pulse" />
                    Creating Workspace...
                  </>
                ) : (
                  <>
                    <Building2 className="mr-2 h-4 w-4" />
                    Create Workspace
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
