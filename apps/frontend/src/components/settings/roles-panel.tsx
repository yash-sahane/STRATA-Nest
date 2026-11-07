'use client';

import * as React from 'react';
import { Eye, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useConfirm } from '@/components/providers/confirm-provider';
import { useMyPermissionKeys } from '@/hooks/use-permissions';
import { ROLE_CONFIG, useTeamMembers } from '@/hooks/use-team';
import {
  useCreateWorkspaceRole,
  useDeleteWorkspaceRole,
  useUpdateWorkspaceRole,
  useWorkspaceRoles,
} from '@/hooks/use-workspace-roles';
import { isBuiltInRole } from '@/lib/permissions';
import {
  BASELINE_KEYS,
  BASELINE_PERMISSIONS,
  BUILT_IN_ROLE_KEYS,
  GRANTABLE_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_REQUIRES,
  canGrantKeys,
  describeRoleKeys,
} from '@/lib/role-catalogue';

/** One row of the list, and what the dialog is opened on. */
interface RoleRow {
  /** Present on a custom role; a built-in has no row to edit. */
  id?: string;
  /** What a membership stores. */
  name: string;
  label: string;
  keys: readonly string[];
  custom: boolean;
}

const ROLE_NAME_MAX = 64;

/** A draft with nothing chosen yet — the dialog's "new role" state. */
const NEW_ROLE: RoleRow = { name: '', label: '', keys: [], custom: true };

/**
 * The roles of a workspace: the seven built in, and the ones it defines itself.
 *
 * The API has stored custom roles, checked every request against them and
 * guarded them against escalation for as long as it has had roles at all — and
 * the only way to create one was to call it by hand. So every workspace ran on
 * the seven built-ins, whose permissions cannot be changed, and anybody whose
 * job fell between two of them was given the larger.
 *
 * Readable by every member: it is also where somebody finds out what their own
 * role allows. Changing anything takes `role:manage`.
 */
export function RolesPanel({ workspaceId }: { workspaceId: string }) {
  const { data: customRoles = [], isLoading, isError, refetch } = useWorkspaceRoles(workspaceId);
  const { data: members = [] } = useTeamMembers(workspaceId);
  const { keys: heldKeys } = useMyPermissionKeys(workspaceId);
  const createRole = useCreateWorkspaceRole();
  const updateRole = useUpdateWorkspaceRole();
  const deleteRole = useDeleteWorkspaceRole();
  const confirm = useConfirm();

  const holds = React.useCallback(
    (key: string) => heldKeys.has('*') || heldKeys.has(key),
    [heldKeys]
  );
  const canManage = holds('role:manage');
  /**
   * Whether a role is the caller's to change: a custom role, `role:manage`,
   * and nothing in it beyond what the caller holds. The API refuses an edit to
   * a role that carries more — emptying one would demote everybody who has it —
   * so such a role opens read-only here instead of failing on Save.
   */
  const canEditRole = React.useCallback(
    (row: RoleRow) => row.custom && canManage && (!row.id || canGrantKeys(heldKeys, row.keys)),
    [canManage, heldKeys]
  );

  // Who holds what, by the name the membership stores.
  const holders = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of members) {
      counts.set(member.rawRole, (counts.get(member.rawRole) ?? 0) + 1);
    }
    return counts;
  }, [members]);

  const rows: RoleRow[] = React.useMemo(
    () => [
      ...(Object.keys(ROLE_CONFIG) as Array<keyof typeof ROLE_CONFIG>).map((key) => ({
        name: key,
        label: ROLE_CONFIG[key].label,
        keys: BUILT_IN_ROLE_KEYS[key],
        custom: false,
      })),
      ...customRoles.map((role) => ({
        id: role.id,
        name: role.name,
        label: role.name,
        keys: role.permissions,
        custom: true,
      })),
    ],
    [customRoles]
  );

  // The dialog: null closed, otherwise the role it shows.
  const [open, setOpen] = React.useState<RoleRow | null>(null);
  const [name, setName] = React.useState('');
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  const openOn = (row: RoleRow) => {
    setOpen(row);
    setName(row.custom ? row.name : row.label);
    setSelected(new Set(row.keys.filter((key) => GRANTABLE_KEYS.includes(key))));
  };

  const editable = open !== null && canEditRole(open);
  const isNew = Boolean(open?.custom) && !open?.id;

  const toggle = (key: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(key);
        // A key that is no use alone brings the one it depends on.
        const needs = PERMISSION_REQUIRES[key];
        if (needs) next.add(needs);
      } else {
        next.delete(key);
        // ...and taking that one away takes its dependants with it.
        for (const [dependant, needs] of Object.entries(PERMISSION_REQUIRES)) {
          if (needs === key) next.delete(dependant);
        }
      }
      return next;
    });
  };

  const trimmedName = name.trim();
  const nameTaken =
    editable &&
    rows.some(
      (row) =>
        row.id !== open?.id &&
        (row.name.toLowerCase() === trimmedName.toLowerCase() ||
          row.label.toLowerCase() === trimmedName.toLowerCase())
    );
  const nameProblem = !editable
    ? null
    : trimmedName === ''
      ? 'Give the role a name.'
      : isBuiltInRole(trimmedName.toUpperCase()) || nameTaken
        ? 'A role with this name already exists.'
        : null;
  const saving = createRole.isPending || updateRole.isPending;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!open || !editable || nameProblem) return;
    // Stored WITH the baseline: the API resolves a custom role to exactly the
    // array it holds, so a role saved without it could not even check in. Keys
    // the catalogue does not know are dropped rather than carried forward.
    const permissions = [...BASELINE_KEYS, ...GRANTABLE_KEYS.filter((key) => selected.has(key))];
    try {
      if (open.id) {
        await updateRole.mutateAsync({
          roleId: open.id,
          workspaceId,
          // Only when it changed: a rename re-points every member who holds
          // the role, and the API checks it as the grant it is.
          ...(trimmedName !== open.name ? { name: trimmedName } : {}),
          permissions,
        });
      } else {
        await createRole.mutateAsync({ workspaceId, name: trimmedName, permissions });
      }
      setOpen(null);
    } catch {
      // the mutation surfaces the reason as a toast; keep the dialog open
    }
  };

  const handleDelete = async (row: RoleRow) => {
    if (!row.id) return;
    const proceed = await confirm({
      title: `Delete the "${row.name}" role?`,
      description:
        'Nobody holds it, so nobody loses access. If an invite code still hands this role out, revoke that code first. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!proceed) return;
    deleteRole.mutate({ roleId: row.id, workspaceId });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Roles</CardTitle>
            <CardDescription>
              A role decides what a member can do in this workspace. The built-in roles are fixed;
              add a custom role when none of them fits.
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => openOn(NEW_ROLE)} className="shrink-0">
              <Plus className="mr-2 h-4 w-4" />
              New Role
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isError ? (
            <ErrorState
              title="Couldn't load this workspace's roles"
              description="The custom roles could not be fetched."
              onRetry={() => refetch()}
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Can do</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const count = holders.get(row.name) ?? 0;
                    return (
                      <TableRow key={row.custom ? `custom:${row.id}` : row.name}>
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            <span className="truncate" title={row.label}>{row.label}</span>
                            <Badge variant={row.custom ? 'secondary' : 'outline'}>
                              {row.custom ? 'Custom' : 'Built-in'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {describeRoleKeys(row.keys)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{count}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                canEditRole(row)
                                  ? `Edit the ${row.label} role`
                                  : `See what the ${row.label} role can do`
                              }
                              onClick={() => openOn(row)}
                            >
                              {canEditRole(row) ? (
                                <Pencil className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                            {/* Offered only when it can succeed: a role somebody
                                holds is not deletable, and the note under the
                                table says what has to happen first. */}
                            {canEditRole(row) && count === 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete the ${row.label} role`}
                                disabled={deleteRole.isPending}
                                onClick={() => handleDelete(row)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Give a member a role under Team &gt; edit member. A new member gets theirs when they
            are added, or from the invite code they join with.
            {canManage &&
              ' A custom role can be deleted once no member holds it and no invite code hands it out; revoke its codes under Team > Add Members > Invite code.'}
          </p>
        </CardContent>
      </Card>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isNew ? 'New role' : editable ? 'Edit role' : `${open?.label ?? 'Role'} role`}
            </DialogTitle>
            <DialogDescription>
              {editable
                ? 'Choose what members with this role can do. You can only grant what your own role allows.'
                : open?.custom
                  ? canManage
                    ? 'What members with this role can do. It includes permissions your own role does not have, so you can read it but not change it.'
                    : 'What members with this role can do.'
                  : 'What members with this role can do. Built-in roles cannot be changed.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              {editable && (
                <div className="space-y-2">
                  <Label htmlFor="role-name">Name</Label>
                  <Input
                    id="role-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={ROLE_NAME_MAX}
                    placeholder="e.g. QA Lead"
                    autoFocus={isNew}
                  />
                  {nameProblem && trimmedName !== '' && (
                    <p className="text-sm text-destructive-text">{nameProblem}</p>
                  )}
                  {open?.id && trimmedName !== open.name && !nameProblem && (
                    <p className="text-sm text-muted-foreground">
                      Members who hold &ldquo;{open.name}&rdquo; keep the role under its new name.
                    </p>
                  )}
                </div>
              )}

              {PERMISSION_GROUPS.map((group) => (
                <fieldset key={group.title} className="space-y-2">
                  <legend className="text-sm font-medium">{group.title}</legend>
                  <div className="space-y-2">
                    {group.permissions.map((permission) => {
                      const checked = selected.has(permission.key);
                      // Nobody grants what they do not hold; the API refuses it.
                      // An already-granted one stays removable.
                      const beyondOwn = editable && !holds(permission.key) && !checked;
                      const fieldId = `role-permission-${permission.key}`;
                      return (
                        <div key={permission.key} className="flex items-start gap-3">
                          <Checkbox
                            id={fieldId}
                            className="mt-0.5"
                            checked={checked}
                            disabled={!editable || beyondOwn}
                            onCheckedChange={(value) => toggle(permission.key, value === true)}
                          />
                          <div className="space-y-0.5">
                            <Label htmlFor={fieldId} className="font-normal leading-snug">
                              {permission.label}
                            </Label>
                            {permission.description && (
                              <p className="text-xs text-muted-foreground">
                                {permission.description}
                              </p>
                            )}
                            {beyondOwn && (
                              <p className="text-xs text-muted-foreground">
                                Your own role does not include this, so you cannot grant it.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              ))}

              <div className="rounded-md border bg-muted/50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" />
                  Included in every role
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {BASELINE_PERMISSIONS.map((permission) => permission.label).join(' · ')}
                </p>
              </div>
            </div>

            <DialogFooter>
              {editable ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving || nameProblem !== null}>
                    {saving ? 'Saving...' : isNew ? 'Create Role' : 'Save Changes'}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" onClick={() => setOpen(null)}>
                  Close
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
