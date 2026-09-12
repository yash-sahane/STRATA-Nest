/**
 * Permission Hooks
 * React hooks for checking user permissions
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { query, resources } from '@/lib/api/client';
import {
    Permission,
    isAdmin,
    isBuiltInRole,
    isManager,
    permissionsOfRole,
    getRolePermissions,
    type Role,
} from '@/lib/permissions';

/** Stable identity for "no permissions", so the memos below don't see a new
 *  array on every render of a workspace the caller is not a member of. */
const NO_PERMISSIONS: Permission[] = [];

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
 * EVERY membership the caller holds, anywhere — one request, whatever the number
 * of workspaces on screen.
 *
 * `useWorkspaceRole` used to answer by fetching the target workspace's whole
 * roster (`['team-members', workspaceId]`) and reading a single row out of it.
 * On the /workspaces list that is one distinct cache key — so one network round
 * trip, of the ENTIRE member list — per rendered card, none of them
 * deduplicated, to learn N facts the server could state in one reply. This query
 * is keyed on the USER, so N cards cost one request and every card reads it from
 * cache.
 */
function useMyMemberships() {
    const { user } = useAuth();
    return useQuery({
        queryKey: ['my-memberships', user?.id],
        enabled: Boolean(user?.id),
        queryFn: async () => {
            if (!user?.id) return [];
            const response = await resources.listAll('workspace_members', [
                query.equal('userId', user.id),
            ]);
            return response.items as Array<{
                workspaceId: string;
                role?: string;
                status?: string;
            }>;
        },
    });
}

/**
 * The CUSTOM role definitions of the workspaces the caller belongs to.
 *
 * A workspace may define `WorkspaceRole` rows with any name, and the API
 * resolves a membership holding one against that row's own permission array
 * (`WorkspaceAccessService.permissionsOfRole`). The client resolved names
 * against the hardcoded matrix of the seven built-ins ONLY, so a custom role
 * was answered with the read-only floor no matter what it granted — a role
 * holding `member:invite` rendered zero Invite buttons while the API returned
 * 201 for the very same principal.
 *
 * One UNFILTERED request: `/api/v1/workspace_roles` is membership-scoped
 * server-side, so it already returns exactly this caller's workspaces' roles.
 * Asking per workspace would be a round trip per card on /workspaces, which is
 * the trap `useMyMemberships` above exists to avoid. Skipped altogether while
 * every membership names a built-in role, which is the ordinary case.
 */
function useMyRoleDefinitions(enabled: boolean) {
    const { user } = useAuth();
    return useQuery({
        queryKey: ['my-role-definitions', user?.id],
        enabled: Boolean(user?.id) && enabled,
        queryFn: async () => {
            const response = await resources.listAll('workspace_roles');
            return response.items as Array<{
                workspaceId: string;
                name: string;
                permissions?: string[];
            }>;
        },
        // Role definitions change when an admin edits the RBAC config, which is
        // rare; every screen asks this question, so don't refetch it per mount.
        staleTime: 5 * 60 * 1000,
    });
}

/** A role name is only unique WITHIN a workspace, so the definition lookup has
 *  to be keyed on both. NUL separator: neither id nor name can contain one. */
const grantKey = (workspaceId: string, role: string) => `${workspaceId}\u0000${role}`;

/**
 * What the caller may do in each workspace they are ACTIVE in.
 *
 * ACTIVE only, because that is the server's own rule: WorkspaceAccessService
 * resolves permissions from `activeMembership`, so an INVITED or deactivated
 * membership carries none. Matching on any status handed those users their
 * former role's affordances and every submit came back 403.
 */
function useMyAccess(): {
    byWorkspace: Map<string, { role: Role; permissions: Permission[] }>;
    isLoading: boolean;
    isError: boolean;
} {
    const { data: memberships = [], isLoading, isError } = useMyMemberships();

    const active = useMemo(
        () => memberships.filter((m): m is { workspaceId: string; role: string; status: string } =>
            m.status === 'ACTIVE' && Boolean(m.role),
        ),
        [memberships],
    );
    const hasCustomRole = useMemo(() => active.some(m => !isBuiltInRole(m.role)), [active]);
    const { data: definitions = [], isLoading: definitionsLoading } =
        useMyRoleDefinitions(hasCustomRole);

    const byWorkspace = useMemo(() => {
        const granted = new Map<string, string[]>();
        for (const definition of definitions) {
            granted.set(
                grantKey(definition.workspaceId, definition.name),
                Array.isArray(definition.permissions) ? definition.permissions : [],
            );
        }
        const map = new Map<string, { role: Role; permissions: Permission[] }>();
        for (const membership of active) {
            const role = membership.role as Role;
            map.set(membership.workspaceId, {
                role,
                permissions: permissionsOfRole(role, granted.get(grantKey(membership.workspaceId, role))),
            });
        }
        return map;
    }, [active, definitions]);

    return {
        byWorkspace,
        // A custom role is not RESOLVED until its definition lands. Reporting
        // "loaded" in that window answers with the read-only floor for a frame,
        // which blinks away the very affordances the definition is about to
        // grant — the same "no vs not yet" confusion the flag exists for.
        isLoading: isLoading || (hasCustomRole && definitionsLoading),
        isError,
    };
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
    isLoading: boolean;
    isError: boolean;
} {
    const { byWorkspace, isLoading, isError } = useMyAccess();
    const access = workspaceId ? byWorkspace.get(workspaceId) : undefined;

    return {
        role: access?.role ?? null,
        permissions: access?.permissions ?? NO_PERMISSIONS,
        isLoading: Boolean(workspaceId) && isLoading,
        isError,
    };
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
 * Check if current user is admin (Manager or Assistant Manager)
 */
export function useIsAdmin(): boolean {
    const role = useUserRole();
    const platformAdmin = useIsPlatformAdmin();

    return useMemo(() => {
        if (platformAdmin) return true;
        if (!role) return false;
        return isAdmin(role);
    }, [role, platformAdmin]);
}

/**
 * Check if current user is manager
 */
export function useIsManager(): boolean {
    const role = useUserRole();
    const platformAdmin = useIsPlatformAdmin();

    return useMemo(() => {
        if (platformAdmin) return true;
        if (!role) return false;
        return isManager(role);
    }, [role, platformAdmin]);
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
            return { permissions: new Set(getRolePermissions('MANAGER')), isLoading: false };
        }
        return { permissions: new Set(permissions), isLoading };
    }, [platformAdmin, permissions, isLoading]);
}
