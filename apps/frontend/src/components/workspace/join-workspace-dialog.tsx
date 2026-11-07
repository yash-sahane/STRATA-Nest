'use client';

import * as React from 'react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { InviteCodeForm } from '@/components/workspace/invite-code-form';
import { RequestAccessForm } from '@/components/guards/request-access-form';

/**
 * Joining ANOTHER workspace, for somebody who already belongs to one.
 *
 * Both ways in — redeeming a code and asking a workspace's managers — were only
 * ever offered on the "No workspace yet" screen, which nobody with a workspace
 * can reach. So the codes managers were told to hand out could be redeemed by
 * almost no one, and a request to join could only be raised by a person who had
 * been removed from everything.
 */
export function JoinWorkspaceDialog() {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <LogIn className="mr-2 h-4 w-4" />
          Join a workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a workspace</DialogTitle>
          <DialogDescription>
            Enter an invite code a manager gave you, or ask a workspace&apos;s managers for access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* The mutation refreshes the list behind this dialog and says so in a
              toast, so there is nothing left to show here. */}
          <InviteCodeForm idPrefix="join-dialog-code" onJoined={() => setOpen(false)} />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <RequestAccessForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
