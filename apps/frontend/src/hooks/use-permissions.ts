/**
 * Permission Hooks
 * React hooks for checking user permissions
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { restClient } from '@/lib/api/rest-client';
import { useWorkspaceRoles } from '@/hooks/use-workspace-roles';
import { canGrantKeys, keysOfRole } from '@/lib/role-catalogue';
import { Permission, permissionsFromKeys, type Role } from '@/lib/permissions';

/** Stable identity for "no permissions", so the memos below don't see a new
 *  array on every render of a workspace the caller is not a member of. */
const NO_PERMISSIONS: Permission[] = [];
const NO_KEYS: readonly string[] = [];
/** What the API answers for a platform admin: every permission, by wildcard. */
const EVERY_KEY: ReadonlySet<string> = new Set(['*']);

/**
 * Platform admins (`isSuperuser || isAdminFlag` on the API side) bypass every
 * workspace permission check in WorkspaceAccessService, so the client must not
 * hide affordances from them — not while the member roster is still loading,
 * and not in a workspace where they hold no membership row at all. This is the
 * one capability answer that does not depend on the roster request.
 */
function useIsPlatformAdmin(): boolean {
    const { user } = useAuth();
    return user?.isAdmin === true;
}

/**
 * What the caller may do in every workspace they are ACTIVE in — one request,
 * answered by the server (GET /auth/me/access), whatever the number of
 * workspaces on screen.
 *
 * The browser used to resolve this itself from the caller's memberships, a
 * hand-kept copy of the API's role matrix, and (for a custom role) the role's
 * stored keys — without the keys the API adds by implication, so a custom role
 * holding `task:write` showed no edit controls the API would have allowed.
 * ACTIVE only, as the server's own checks: an invited or switched-off
 * membership carries nothing.
 */
function useMyAccess(): {
    byWorkspace: Map<string, { role: Role; permissions: Permission[]; keys: readonly string[] }>;
    isLoading: boolean;
    isError: boolean;
} {
    const { user } = useAuth();
    const { data, isLoading, isError } = useQuery({
        queryKey: ['my-access', user?.id],
        enabled: Boolean(user?.id),
        queryFn: async () =>
            (await restClient.get('/api/v1/auth/me/access/')) as {
                platformAdmin: boolean;
                workspaces: Array<{ workspaceId: string; role: string; permissions: string[] }>;
            },
    });
    const byWorkspace = useMemo(() => {
        const map = new Map<string, { role: Role; permissions: Permission[]; keys: readonly string[] }>();
        for (const membership of data?.workspaces ?? []) {
            map.set(membership.workspaceId, {
                role: membership.role as Role,
                permissions: permissionsFromKeys(membership.permissions),
                keys: membership.permissions,
            });
        }
        return map;
    }, [data]);
    return { byWorkspace, isLoading, isError };
}

/**
 * The caller's role and resolved permissions in an ARBITRARY workspace, plus
 * whether the answer is still loading and whether it FAILED.
 *
 * The hooks below all resolve against `currentWorkspace`, which is wrong for any
 * screen that renders rows from several workspaces (the /workspaces list) or a
 * resource that lives in a workspace other than the selected one (a project
 * opened by link). It is also why a page must not decide "Access Denied" from a
 * bare boolean: the role is `null` until the membership list resolves.
 *
 * `permissions` is the resolved set rather than something the caller derives
 * from `role`, because a custom role's name says nothing about what it grants —
 * only the workspace's own definition does.
 *
 * `isError` is returned separately and deliberately: collapsing "the request
 * failed" into `role === null` makes a 5xx indistinguishable from "you are not a
 * member", and a page that reads only the boolean then renders an affirmatively
 * wrong, non-recoverable "Access Denied".
 */
export function useWorkspaceRole(workspaceId?: string): {
    role: Role | null;
    permissions: Permission[];
    /** The same grant as API permission keys — see `useMyPermissionKeys`. */
    keys: readonly string[];
    isLoading: boolean;
    isError: boolean;
} {
    const { byWorkspace, isLoading, isError } = useMyAccess();
    const access = workspaceId ? byWorkspace.get(workspaceId) : undefined;

    return {
        role: access?.role ?? null,
        permissions: access?.permissions ?? NO_PERMISSIONS,
        keys: access?.keys ?? NO_KEYS,
        isLoading: Boolean(workspaceId) && isLoading,
        isError,
    };
}

/**
 * The API permission keys the caller holds in a workspace (`*` for a platform
 * admin, who is not ranked).
 *
 * For what `useHasPermission` cannot express. That hook answers in the
 * screen-level enum, which folds several API keys together and has no entry at
 * all for `role:manage`, `invite:manage` or `join:manage` — so "may this person
 * edit roles?" had nothing to ask.
 */
export function useMyPermissionKeys(workspaceId: string | undefined): {
    keys: ReadonlySet<string>;
    isLoading: boolean;
} {
    const platformAdmin = useIsPlatformAdmin();
    const { keys, isLoading } = useWorkspaceRole(workspaceId);
    return useMemo(
        () =>
            platformAdmin
                ? { keys: EVERY_KEY, isLoading: false }
                : { keys: new Set(keys), isLoading },
        [platformAdmin, keys, isLoading],
    );
}

/** Whether the caller holds one API permission key in a workspace. */
export function useHasPermissionKey(workspaceId: string | undefined, key: string): boolean {
    const { keys } = useMyPermissionKeys(workspaceId);
    return keys.has('*') || keys.has(key);
}

/**
 * Get current user's role in the workspace, exactly as the membership stores it.
 *
 * Answered from the caller's own membership list rather than the workspace
 * ROSTER, which is where it used to come from: `useTeamMembers` normalizes every
 * unrecognised name to 'MEMBER' for display (that is what `TeamMember.rawRole`
 * exists for), so a custom role arrived here as MEMBER and was resolved against
 * the built-in matrix under a name its holder does not have. It also drops a
 * whole roster fetch from every screen that only wanted to know what the caller
 * may do.
 */
export function useUserRole(): Role | null {
    const { currentWorkspace } = useCurrentWorkspace();
    return useWorkspaceRole(currentWorkspace?.id).role;
}

/** `useHasPermission` for a named workspace. Platform admins answer `true`
 *  immediately — they bypass every workspace check server-side, so they must
 *  never be gated on a request that may not even include them. */
export function useHasPermissionIn(
    workspaceId: string | undefined,
    permission: Permission,
): { allowed: boolean; isLoading: boolean; isError: boolean } {
    const platformAdmin = useIsPlatformAdmin();
    const { permissions, isLoading, isError } = useWorkspaceRole(workspaceId);

    return useMemo(() => {
        if (platformAdmin) return { allowed: true, isLoading: false, isError: false };
        return {
            allowed: permissions.includes(permission),
            isLoading,
            isError,
        };
    }, [platformAdmin, permissions, isLoading, isError, permission]);
}

/**
 * Which roles the caller may hand out — or touch — in a workspace.
 *
 * The API refuses a role grant above the caller's own (and refuses to change or
 * remove a member who outranks them), so every role picker and member action
 * asks this first rather than offering a choice that comes back 403. Platform
 * admins are not ranked.
 *
 * Answered in API keys, against the workspace's own role definitions. It used to
 * compare screen-level permissions with no definition in hand, so every custom
 * role resolved to the read-only floor and looked grantable by anybody — a role
 * carrying `workspace:delete` was offered to a member who could add people, and
 * the server refused it.
 */
export function useCanGrantRole(workspaceId: string | undefined): (role: Role) => boolean {
    const { keys } = useMyPermissionKeys(workspaceId);
    const { data: customRoles } = useWorkspaceRoles(workspaceId);
    return useCallback(
        (role: Role) => {
            const definition = customRoles?.find((custom) => custom.name === role);
            return canGrantKeys(keys, keysOfRole(role, definition?.permissions));
        },
        [keys, customRoles],
    );
}

/**
 * `useHasPermission` for the CURRENT workspace that distinguishes "no" from
 * "not yet".
 *
 * `useHasPermission` returns a bare boolean, so an unresolved membership is
 * indistinguishable from a refusal — which is how a genuine manager who dragged
 * a card onto Done on first paint was told they were not a manager. Use this
 * wherever a denial is USER-VISIBLE (an error toast, a blocked action) rather
 * than merely a hidden button.
 */
export function useHasPermissionResolved(
    permission: Permission,
): { allowed: boolean; isLoading: boolean } {
    const { currentWorkspace } = useCurrentWorkspace();
    const { allowed, isLoading } = useHasPermissionIn(currentWorkspace?.id, permission);
    return useMemo(() => ({ allowed, isLoading }), [allowed, isLoading]);
}

/**
 * Check if current user has a specific permission
 */
export function useHasPermission(permission: Permission): boolean {
    return useHasPermissionResolved(permission).allowed;
}

/**
 * The caller's whole permission set for the current workspace, as a Set, with
 * the loading flag alongside.
 *
 * Built for the sidebar, which asks "may I see this?" once per destination and
 * must be able to tell "no" from "not yet" — `usePermissions()` returns `[]` in
 * both cases, which would blank the navigation on every cold load.
 */
export function useNavigationPermissions(): { permissions: Set<Permission>; isLoading: boolean } {
    const platformAdmin = useIsPlatformAdmin();
    const { currentWorkspace } = useCurrentWorkspace();
    const { permissions, isLoading } = useWorkspaceRole(currentWorkspace?.id);

    return useMemo(() => {
        if (platformAdmin) {
            return { permissions: new Set(permissionsFromKeys(['*'])), isLoading: false };
        }
        return { permissions: new Set(permissions), isLoading };
    }, [platformAdmin, permissions, isLoading]);
}
