'use client';

import * as React from 'react';
import { Pencil, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useAdjustLeaveBalance,
  useTeamLeaveBalances,
  type TeamLeaveBalance,
} from '@/hooks/use-leave';
import { useLeaveApprovers } from '@/hooks/use-leave';
import { isEditConflict } from '@/lib/api/mutation-error';

/** A figure typed into a number field, or null while it is not a usable one. */
function parseAllowance(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 366 ? n : null;
}

/**
 * Every member's leave balance for the year, with the means to change it.
 *
 * A balance was provisioned with a fixed default the first time its owner opened
 * the Leave page and could not be touched afterwards: no screen granted comp-off
 * for a weekend worked, corrected an allowance for somebody who joined mid-year,
 * or even showed an approver who had how much left.
 */
export function TeamBalancesPanel({ workspaceId }: { workspaceId: string }) {
  const { user } = useAuth();
  // Your own allowance is another approver's to change — unless there is none.
  const { data: approvers = [] } = useLeaveApprovers(workspaceId);
  const soleApprover = !approvers.some((a) => a.userId !== user?.id);
  const year = new Date().getFullYear();
  const {
    data: balances = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useTeamLeaveBalances(workspaceId, year);
  const adjust = useAdjustLeaveBalance();

  const [editing, setEditing] = React.useState<TeamLeaveBalance | null>(null);
  const [paidLeave, setPaidLeave] = React.useState('');
  const [halfDay, setHalfDay] = React.useState('');
  const [compOff, setCompOff] = React.useState('');

  /**
   * Open on the figures as they are NOW, not as this table last drew them.
   *
   * Approvals and cancellations move a balance from other screens and other
   * people's browsers. The dialog is filled from a fresh read, and remembers
   * what it was filled with so that saving sends only what the approver
   * changed — a comp-off grant no longer rewrites paid leave with whatever
   * number happened to be on screen.
   */
  const openEditor = async (row: TeamLeaveBalance) => {
    const fresh = (await refetch()).data?.find((r) => r.userId === row.userId) ?? row;
    setEditing(fresh);
    setPaidLeave(String(fresh.paidLeave));
    setHalfDay(String(fresh.halfDay));
    setCompOff(String(fresh.compOff));
  };

  const figures = {
    paidLeave: parseAllowance(paidLeave),
    halfDay: parseAllowance(halfDay),
    compOff: parseAllowance(compOff),
  };
  const valid = figures.paidLeave !== null && figures.halfDay !== null && figures.compOff !== null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !valid) return;
    try {
      const changed: { paidLeave?: number; halfDay?: number; compOff?: number } = {};
      // ...and what each changed figure held when the dialog was filled, so the
      // API can refuse one that an approval or cancellation has moved since.
      const basedOn: typeof changed = {};
      if (figures.paidLeave !== editing.paidLeave) {
        changed.paidLeave = figures.paidLeave as number;
        basedOn.paidLeave = editing.paidLeave;
      }
      if (figures.halfDay !== editing.halfDay) {
        changed.halfDay = figures.halfDay as number;
        basedOn.halfDay = editing.halfDay;
      }
      if (figures.compOff !== editing.compOff) {
        changed.compOff = figures.compOff as number;
        basedOn.compOff = editing.compOff;
      }
      if (Object.keys(changed).length > 0) {
        await adjust.mutateAsync({ workspaceId, userId: editing.userId, year, ...changed, basedOn });
      }
      setEditing(null);
    } catch (error) {
      // The mutation surfaces the reason as a toast; keep the dialog open. When
      // the figures moved under it, show the ones there are now: the typed
      // figure was decided against a balance that no longer exists.
      if (isEditConflict(error)) await openEditor(editing);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team balances — {year}</CardTitle>
          <CardDescription>
            What each member has left this year. Approved leave is deducted automatically; change a
            figure here to grant comp-off or correct an allowance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState
              title="Couldn't load the team's balances"
              description="The balances for this workspace could not be fetched."
              onRetry={() => refetch()}
            />
          ) : balances.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No members yet"
              description="Balances appear here once the workspace has members."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead className="text-right">Paid leave</TableHead>
                    <TableHead className="text-right">Half-day sessions</TableHead>
                    <TableHead className="text-right">Comp-off</TableHead>
                    <TableHead className="text-right">Unpaid taken</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((row) => {
                    const isSelf = row.userId === user?.id;
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            <span className="truncate" title={row.userName}>{row.userName}</span>
                            {isSelf && <Badge variant="secondary">You</Badge>}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {row.userEmail}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.paidLeave}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.halfDay}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.compOff}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.unpaidLeave}</TableCell>
                        <TableCell className="text-right">
                          {/* The API refuses a caller's own row, the same way it
                              refuses approving your own leave — so say so here
                              rather than offer an edit that comes back 403. */}
                          {isSelf && !soleApprover ? (
                            // Said in words, where it can be read: a `title` on
                            // a disabled button is shown to nobody.
                            <span className="text-xs text-muted-foreground">
                              Another approver changes yours
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isFetching}
                              onClick={() => void openEditor(row)}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Adjust
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust leave balance</DialogTitle>
            <DialogDescription>
              {editing
                ? `What ${editing.userName} has left for ${year}. These are remaining figures, not yearly totals.`
                : 'Set what this member has left for the year.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="balance-paid">Paid leave (days)</Label>
                <Input
                  id="balance-paid"
                  type="number"
                  min={0}
                  max={366}
                  step={0.5}
                  value={paidLeave}
                  onChange={(e) => setPaidLeave(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="balance-half">Half-day sessions</Label>
                <Input
                  id="balance-half"
                  type="number"
                  min={0}
                  max={366}
                  step={1}
                  value={halfDay}
                  onChange={(e) => setHalfDay(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="balance-comp">Comp-off (days)</Label>
                <Input
                  id="balance-comp"
                  type="number"
                  min={0}
                  max={366}
                  step={0.5}
                  value={compOff}
                  onChange={(e) => setCompOff(e.target.value)}
                />
              </div>
            </div>
            {!valid && (
              <p className="text-sm text-destructive-text">
                Each figure has to be a number between 0 and 366.
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || adjust.isPending}>
                {adjust.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
