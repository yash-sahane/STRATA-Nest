import { useWorkspaceContext } from '@/components/providers/workspace-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
import { useAuth } from '@/components/providers/auth-provider';
import { useEffect } from 'react';
import { setWorkingWeek, setWorkspaceTimeZone } from '@/lib/utils/working-days';
import { toast } from 'sonner';

/**
 * Hook to get the current active workspace
 * Persists selection in localStorage via WorkspaceProvider
 *
 * Choosing a workspace when none is selected — and moving off one that has
 * gone — is WorkspaceProvider's job, done once there. It used to run here, once
 * per component using this hook, and every copy raised its own toast.
 */
export function useCurrentWorkspace() {
    const { user } = useAuth();
    const { currentWorkspaceId, setCurrentWorkspaceId: setWorkspaceId } = useWorkspaceContext();
    const { data: workspaces, isLoading } = useWorkspaces(user?.id);

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

    // ...and on its working week: which Saturdays the calendar, the attendance rate
    // and a leave's day count treat as working days, the way the API counts them.
    // Keyed by its text so a refetch that changes nothing does not re-run it.
    const workingWeekKey = JSON.stringify(currentWorkspace?.settings?.workingWeek ?? []);
    useEffect(() => {
        setWorkingWeek({ workingWeek: JSON.parse(workingWeekKey) });
    }, [workingWeekKey]);

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
