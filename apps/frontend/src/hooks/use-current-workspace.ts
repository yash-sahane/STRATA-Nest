import { useWorkspaceContext } from '@/components/providers/workspace-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
import { useAuth } from '@/components/providers/auth-provider';
import { useEffect } from 'react';
import { setWorkspaceTimeZone } from '@/lib/utils/working-days';
import { toast } from 'sonner';

/**
 * Hook to get the current active workspace
 * Automatically selects first workspace if none is selected
 * Persists selection in localStorage via WorkspaceProvider
 */
export function useCurrentWorkspace() {
    const { user } = useAuth();
    const { currentWorkspaceId, setCurrentWorkspaceId: setWorkspaceId } = useWorkspaceContext();
    const { data: workspaces, isLoading, isFetching } = useWorkspaces(user?.id);

    // Auto-select the first workspace when none is selected — and self-heal when
    // the persisted id no longer resolves against the fetched list (workspace
    // deleted, or the user's membership revoked). Guarding on `!currentWorkspaceId`
    // alone left a stale localStorage id in place forever, so `currentWorkspace`
    // stayed undefined and every page rendered "No Workspace Found".
    //
    // `isFetching` is part of the condition because this effect can now OVERRIDE
    // an explicit selection: while an invalidated list is refetching, the cached
    // array is the pre-write one, and a workspace that was just created (or just
    // joined) legitimately is not in it yet. Deciding on in-flight data reverted
    // the user to workspaces[0] and rewrote localStorage behind them.
    useEffect(() => {
        if (isFetching) return;
        if (!workspaces || workspaces.length === 0) return;
        if (workspaces.some((w) => w.id === currentWorkspaceId)) return;
        setWorkspaceId(workspaces[0].id);
    }, [currentWorkspaceId, workspaces, isFetching, setWorkspaceId]);

    // Find current workspace object
    const currentWorkspace = workspaces?.find(w => w.id === currentWorkspaceId);

    // Keep the date helpers on the workspace's own calendar.
    //
    // The API files attendance against `Workspace.settings.timezone` when it is set, so
    // the browser has to resolve "today" the same way or the two disagree — which is
    // exactly how a member in another timezone came to see their check-in land on a day
    // their own calendar called tomorrow. Null when the workspace has declared nothing,
    // which falls the resolution through to the server's zone.
    const workspaceTimeZone =
        typeof currentWorkspace?.settings?.timezone === 'string'
            ? currentWorkspace.settings.timezone
            : null;
    useEffect(() => {
        setWorkspaceTimeZone(workspaceTimeZone);
    }, [workspaceTimeZone]);

    // Wrapper function that adds toast notification
    const setCurrentWorkspaceId = (id: string) => {
        // Find workspace BEFORE switching (to get the name)
        const targetWorkspace = workspaces?.find(w => w.id === id);

        // Switch workspace (this clears cache)
        setWorkspaceId(id);

        // Show toast notification
        showWorkspaceSwitchToast(targetWorkspace?.name);
    };

    return {
        currentWorkspace,
        currentWorkspaceId,
        workspaces,
        isLoading,
        setCurrentWorkspaceId,
    };
}

/**
 * Show toast notification for workspace switch
 * Extracted for better testability and reusability
 */
function showWorkspaceSwitchToast(workspaceName?: string): void {
    if (workspaceName) {
        toast.success(`Switched to ${workspaceName}`, {
            description: 'Workspace data updated',
            duration: 3000,
        });
    } else {
        toast.success('Workspace switched', {
            description: 'Workspace data updated',
            duration: 3000,
        });
    }
}
