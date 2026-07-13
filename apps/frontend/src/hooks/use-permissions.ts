/**
 * Permission Hooks
 * React hooks for checking user permissions
 */

import { useMemo } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTeamMembers } from '@/hooks/use-team';
import {
    Permission,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isAdmin,
    isManager,
    getRolePermissions,
    type Role,
} from '@/lib/permissions';

/**
 * Get current user's workspace member record and role
 */
export function useCurrentMember() {
    const { user } = useAuth();
    const { currentWorkspace } = useCurrentWorkspace();
    const { data: teamMembers = [] } = useTeamMembers(currentWorkspace?.id);

    return useMemo(() => {
        if (!user || !teamMembers.length) return null;
        return teamMembers.find(member => member.userId === user.id);
    }, [user, teamMembers]);
}

/**
 * Get current user's role in the workspace
 */
export function useUserRole(): Role | null {
    const currentMember = useCurrentMember();
    return currentMember?.role || null;
}

/**
 * Check if current user has a specific permission
 */
export function useHasPermission(permission: Permission): boolean {
    const role = useUserRole();

    return useMemo(() => {
        if (!role) return false;
        return hasPermission(role, permission);
    }, [role, permission]);
}

/**
 * Check if current user has any of the specified permissions
 */
export function useHasAnyPermission(permissions: Permission[]): boolean {
    const role = useUserRole();

    return useMemo(() => {
        if (!role) return false;
        return hasAnyPermission(role, permissions);
    }, [role, permissions]);
}

/**
 * Check if current user has all of the specified permissions
 */
export function useHasAllPermissions(permissions: Permission[]): boolean {
    const role = useUserRole();

    return useMemo(() => {
        if (!role) return false;
        return hasAllPermissions(role, permissions);
    }, [role, permissions]);
}

/**
 * Check if current user is admin (Manager or Assistant Manager)
 */
export function useIsAdmin(): boolean {
    const role = useUserRole();

    return useMemo(() => {
        if (!role) return false;
        return isAdmin(role);
    }, [role]);
}

/**
 * Check if current user is manager
 */
export function useIsManager(): boolean {
    const role = useUserRole();

    return useMemo(() => {
        if (!role) return false;
        return isManager(role);
    }, [role]);
}

/**
 * Get all permissions for current user
 */
export function usePermissions(): Permission[] {
    const role = useUserRole();

    return useMemo(() => {
        if (!role) return [];
        return getRolePermissions(role);
    }, [role]);
}

/**
 * Get comprehensive permission object for current user
 */
export function useUserPermissions() {
    const role = useUserRole();
    const currentMember = useCurrentMember();
    const permissions = usePermissions();
    const isAdminUser = useIsAdmin();
    const isManagerUser = useIsManager();

    return useMemo(() => ({
        role,
        member: currentMember,
        permissions,
        isAdmin: isAdminUser,
        isManager: isManagerUser,
        can: (permission: Permission) => role ? hasPermission(role, permission) : false,
        canAny: (perms: Permission[]) => role ? hasAnyPermission(role, perms) : false,
        canAll: (perms: Permission[]) => role ? hasAllPermissions(role, perms) : false,
    }), [role, currentMember, permissions, isAdminUser, isManagerUser]);
}
