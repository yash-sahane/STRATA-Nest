'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clearWorkspaceScopedCache, clearAllCache } from '@/lib/cache-utils';
import {
    getCurrentWorkspaceId,
    setCurrentWorkspaceId as saveWorkspaceId,
    removeCurrentWorkspaceId
} from '@/lib/storage-utils';

interface WorkspaceContextType {
    currentWorkspaceId: string | null;
    setCurrentWorkspaceId: (id: string) => void;
    clearWorkspaceData: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
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

    const setCurrentWorkspaceId = (id: string) => {
        // Clear all workspace-scoped cache to prevent data leakage
        clearWorkspaceScopedCache(queryClient);

        // Update state and localStorage
        setCurrentWorkspaceIdState(id);
        if (mounted) {
            saveWorkspaceId(id);
        }
    };

    const clearWorkspaceData = () => {
        clearAllCache(queryClient);
        setCurrentWorkspaceIdState(null);
        if (mounted) {
            removeCurrentWorkspaceId();
        }
    };

    return (
        <WorkspaceContext.Provider value={{
            currentWorkspaceId,
            setCurrentWorkspaceId,
            clearWorkspaceData
        }}>
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
