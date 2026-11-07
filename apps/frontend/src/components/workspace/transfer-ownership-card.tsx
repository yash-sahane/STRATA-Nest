'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useTeamMembers } from '@/hooks/use-team';
import { useWorkspaceRoles } from '@/hooks/use-workspace-roles';
import { useTransferOwnership } from '@/hooks/use-workspace';
import { keysOfRole } from '@/lib/role-catalogue';

/**
 * Hand the workspace to another of its managers.
 *
 * The owner cannot be demoted, removed or leave, so whoever created a workspace
 * held it for good — including an administrator who set it up for a team. Only
 * somebody whose role could run it (one holding workspace:delete, as the
 * owner's does) can take it; the server applies the same rule.
 */
export function TransferOwnershipCard({
  workspaceId,
  workspaceName,
  ownerId,
}: {
  workspaceId: string;
  workspaceName: string;
  ownerId: string;
}) {
  const confirm = useConfirm();
  const { data: members = [] } = useTeamMembers(workspaceId);
  const { data: roles = [] } = useWorkspaceRoles(workspaceId);
  const transfer = useTransferOwnership();
  const [userId, setUserId] = React.useState('');

  const candidates = React.useMemo(
    () =>
      members.filter((member) => {
        if (member.userId === ownerId || member.status !== 'ACTIVE') return false;
        const custom = roles.find((role) => role.name === member.rawRole)?.permissions;
        return keysOfRole(member.rawRole, custom).includes('workspace:delete');
      }),
    [members, roles, ownerId]
  );
  const chosen = candidates.find((member) => member.userId === userId);

  const handOver = async () => {
    if (!chosen) return;
    const ok = await confirm({
      title: `Hand ${workspaceName} to ${chosen.name}?`,
      description:
        'They become its owner: only they can delete it or hand it on. You stay a member with the role you have now.',
      confirmText: 'Hand it over',
    });
    if (!ok) return;
    await transfer.mutateAsync({ workspaceId, userId: chosen.userId, name: chosen.name });
    setUserId('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Owner</CardTitle>
        <CardDescription>
          The owner is the one person who can delete this workspace or hand it on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            To hand it on, first give somebody the Manager role on the Team page.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="transfer-owner">New owner</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="transfer-owner">
                  <SelectValue placeholder="Choose a manager" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.name} · {member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" disabled={!chosen || transfer.isPending} onClick={handOver}>
              {transfer.isPending ? 'Handing over…' : 'Hand it over'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
