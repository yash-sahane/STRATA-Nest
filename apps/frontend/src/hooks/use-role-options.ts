import { useCallback, useMemo } from 'react';
import { useCanGrantRole } from '@/hooks/use-permissions';
import { ROLE_CONFIG } from '@/hooks/use-team';
import { useWorkspaceRoles } from '@/hooks/use-workspace-roles';

export interface RoleOption {
  /** What a membership stores: a built-in key, or a custom role's name. */
  value: string;
  label: string;
  /** Defined by this workspace rather than built in. */
  custom: boolean;
}

/** The seven built-in roles, labelled as everywhere else in the app. */
const BUILT_IN_OPTIONS: RoleOption[] = (
  Object.keys(ROLE_CONFIG) as Array<keyof typeof ROLE_CONFIG>
).map((key) => ({ value: key, label: ROLE_CONFIG[key].label, custom: false }));

/** A role's name as people read it. A custom role is shown as it was named. */
export function roleDisplayName(role: string): string {
  return (ROLE_CONFIG as Record<string, { label: string } | undefined>)[role]?.label ?? role;
}

/**
 * The roles that exist in a workspace, and the ones the caller may hand out.
 *
 * Every role picker reads this. They each used to carry their own copy of the
 * seven built-ins — three lists, two spellings of one label — and none of them
 * offered a custom role, so a role a workspace had defined could be held (the
 * API assigned it happily) but never chosen from any screen.
 */
export function useRoleOptions(workspaceId: string | undefined): {
  all: RoleOption[];
  grantable: RoleOption[];
  isLoading: boolean;
} {
  const { data: customRoles, isLoading } = useWorkspaceRoles(workspaceId);
  const canGrant = useCanGrantRole(workspaceId);

  const all = useMemo(
    () => [
      ...BUILT_IN_OPTIONS,
      ...(customRoles ?? []).map((role) => ({ value: role.name, label: role.name, custom: true })),
    ],
    [customRoles]
  );
  const grantable = useMemo(() => all.filter((option) => canGrant(option.value)), [all, canGrant]);

  return { all, grantable, isLoading };
}

/** `useRoleOptions(...).grantable`, plus one role kept selectable regardless —
 *  the one a member already holds, so an edit form is never blank. */
export function useGrantableRolesWith(
  workspaceId: string | undefined
): (current?: string) => RoleOption[] {
  const { all, grantable } = useRoleOptions(workspaceId);
  return useCallback(
    (current?: string) => {
      if (!current || grantable.some((option) => option.value === current)) return grantable;
      const held = all.find((option) => option.value === current) ?? {
        value: current,
        label: current,
        custom: true,
      };
      return [held, ...grantable];
    },
    [all, grantable]
  );
}
