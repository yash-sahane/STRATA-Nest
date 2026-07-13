import { useWorkspaceContext } from '@/components/providers/workspace-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
import { useAuth } from '@/components/providers/auth-provider';
import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Hook to get the current active workspace
 * Automatically selects first workspace if none is selected
 * Persists selection in localStorage via WorkspaceProvider
 */
export function useCurrentWorkspace() {
    const { user } = useAuth();
    const { currentWorkspaceId, setCurrentWorkspaceId: setWorkspaceId } = useWorkspaceContext();
    const { data: workspaces, isLoading } = useWorkspaces(user?.id);

    // Auto-select first workspace if none selected and workspaces exist
    useEffect(() => {
        if (!currentWorkspaceId && workspaces && workspaces.length > 0) {
            setWorkspaceId(workspaces[0].id);
        }
    }, [currentWorkspaceId, workspaces, setWorkspaceId]);

    // Find current workspace object
    const currentWorkspace = workspaces?.find(w => w.id === currentWorkspaceId);

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
