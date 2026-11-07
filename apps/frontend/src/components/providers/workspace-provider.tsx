'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/auth-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
import { WORKSPACE_DIRECTORY_KEY, fetchWorkspaceDirectory } from '@/hooks/use-join-request';
import { clearWorkspaceScopedCache, clearAllCache } from '@/lib/cache-utils';
import {
    getCurrentWorkspaceId,
    setCurrentWorkspaceId as saveWorkspaceId,
    removeCurrentWorkspaceId
} from '@/lib/storage-utils';

/** Why the caller is about to stop seeing a workspace, when it is their own doing. */
export type WorkspaceDeparture = 'left' | 'deleted';

interface WorkspaceContextType {
    currentWorkspaceId: string | null;
    setCurrentWorkspaceId: (id: string) => void;
    clearWorkspaceData: () => void;
    /** Say, before the list refetches, that the caller themselves left or deleted
     *  a workspace — so losing it is not reported as somebody else's doing. */
    noteDeparture: (workspaceId: string, why: WorkspaceDeparture) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

/**
 * Tell the person why the workspace they had open is gone, once.
 *
 * Their own doing (they left it, or deleted it) has already been confirmed by
 * that action's toast, so only where they are now is said. Otherwise the
 * directory — every workspace they are not active in — tells the causes apart:
 * there and switched off, there and no longer a member, or not there at all.
 */
async function announceLoss(
    lost: { id: string; name: string },
    next: { name: string },
    departure: WorkspaceDeparture | undefined,
    directory: () => Promise<Array<{ id: string; accessSwitchedOff?: boolean }>>,
): Promise<void> {
    const where = `You are in ${next.name} now.`;
    if (departure) {
        toast.info(`You are in ${next.name} now`);
        return;
    }
    try {
        const entry = (await directory()).find((w) => w.id === lost.id);
        if (!entry) {
            toast.warning(`${lost.name} was deleted`, { description: where });
        } else if (entry.accessSwitchedOff) {
            toast.warning(`Your access to ${lost.name} was switched off`, { description: where });
        } else {
            toast.warning(`You are no longer a member of ${lost.name}`, { description: where });
        }
    } catch {
        toast.warning(`You no longer have access to ${lost.name}`, {
            description: `It was deleted, or your access to it was removed. ${where}`,
        });
    }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const { data: workspaces, isFetching } = useWorkspaces(user?.id);
    const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    // Load from localStorage on mount
    useEffect(() => {
        setMounted(true);
        const stored = getCurrentWorkspaceId();
        if (stored) {
            setCurrentWorkspaceIdState(stored);
        }
    }, []);

    const setCurrentWorkspaceId = useCallback((id: string) => {
        // Clear all workspace-scoped cache to prevent data leakage
        clearWorkspaceScopedCache(queryClient);

        // Update state and localStorage
        setCurrentWorkspaceIdState(id);
        if (mounted) {
            saveWorkspaceId(id);
        }
    }, [queryClient, mounted]);

    const clearWorkspaceData = useCallback(() => {
        clearAllCache(queryClient);
        setCurrentWorkspaceIdState(null);
        if (mounted) {
            removeCurrentWorkspaceId();
        }
    }, [queryClient, mounted]);

    // Stamped, and trusted for a minute only: a note about a workspace that was
    // not the open one is never consumed, and must not explain away a later
    // loss of the same workspace (re-joined, then removed by somebody else).
    const departures = useRef(new Map<string, { why: WorkspaceDeparture; at: number }>());
    const noteDeparture = useCallback((workspaceId: string, why: WorkspaceDeparture) => {
        departures.current.set(workspaceId, { why, at: Date.now() });
    }, []);

    // Auto-select the first workspace when none is selected — and self-heal when
    // the persisted id no longer resolves against the fetched list (workspace
    // deleted, or the user's membership revoked). Guarding on `!currentWorkspaceId`
    // alone left a stale localStorage id in place forever, so `currentWorkspace`
    // stayed undefined and every page rendered "No Workspace Found".
    //
    // Here, once, and not in useCurrentWorkspace: that hook is mounted by dozens
    // of components at a time, and each copy ran this and raised its own toast,
    // so losing a workspace stacked a pile of identical warnings.
    //
    // `isFetching` is part of the condition because this effect can OVERRIDE an
    // explicit selection: while an invalidated list is refetching, the cached
    // array is the pre-write one, and a workspace that was just created (or just
    // joined) legitimately is not in it yet. Deciding on in-flight data reverted
    // the user to workspaces[0] and rewrote localStorage behind them. `mounted`
    // waits for the stored selection to be read, or the first workspace would
    // win over it on every load.
    //
    // The workspace that was open is remembered by name, so that losing it can
    // be SAID: it used to swap silently to another workspace, and the person was
    // looking at a different team's work with no word of why.
    const lastOpen = useRef<{ id: string; name: string } | null>(null);
    useEffect(() => {
        if (!mounted || isFetching) return;
        if (!workspaces || workspaces.length === 0) return;
        if (workspaces.some((w) => w.id === currentWorkspaceId)) return;
        const lost = lastOpen.current;
        const next = workspaces[0];
        setCurrentWorkspaceId(next.id);
        if (!lost || lost.id !== currentWorkspaceId) return;
        lastOpen.current = null;
        const note = departures.current.get(lost.id);
        departures.current.delete(lost.id);
        const departure = note && Date.now() - note.at < 60_000 ? note.why : undefined;
        void announceLoss(lost, next, departure, () =>
            queryClient.fetchQuery({
                queryKey: WORKSPACE_DIRECTORY_KEY,
                queryFn: fetchWorkspaceDirectory,
                staleTime: 0,
            }),
        );
    }, [mounted, isFetching, workspaces, currentWorkspaceId, setCurrentWorkspaceId, queryClient]);

    useEffect(() => {
        const open = workspaces?.find((w) => w.id === currentWorkspaceId);
        if (open) lastOpen.current = { id: open.id, name: open.name };
    }, [workspaces, currentWorkspaceId]);

    const value = useMemo(
        () => ({ currentWorkspaceId, setCurrentWorkspaceId, clearWorkspaceData, noteDeparture }),
        [currentWorkspaceId, setCurrentWorkspaceId, clearWorkspaceData, noteDeparture],
    );

    return (
        <WorkspaceContext.Provider value={value}>
            {children}
        </WorkspaceContext.Provider>
    );
}

export function useWorkspaceContext() {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error('useWorkspaceContext must be used within WorkspaceProvider');
    }
    return context;
}
