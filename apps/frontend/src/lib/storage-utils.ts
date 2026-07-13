/**
 * LocalStorage utilities for workspace management
 * Provides type-safe access to localStorage with error handling
 */

import { logger } from '@/lib/logger';

const STORAGE_KEYS = {
    CURRENT_WORKSPACE_ID: 'currentWorkspaceId',
    SIDEBAR_COLLAPSED: 'sidebar-collapsed',
    COMPACT_MODE: 'compact-mode',
    NO_ANIMATIONS: 'no-animations',
} as const;

/**
 * Get current workspace id from localStorage
 */
export function getCurrentWorkspaceId(): string | null {
    if (typeof window === 'undefined') return null;

    try {
        return localStorage.getItem(STORAGE_KEYS.CURRENT_WORKSPACE_ID);
    } catch (error) {
        logger.error('Error reading workspace id from localStorage', { error });
        return null;
    }
}

/**
 * Set current workspace id in localStorage
 */
export function setCurrentWorkspaceId(id: string): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.setItem(STORAGE_KEYS.CURRENT_WORKSPACE_ID, id);
    } catch (error) {
        logger.error('Error saving workspace id to localStorage', { error });
    }
}

/**
 * Remove current workspace id from localStorage
 */
export function removeCurrentWorkspaceId(): void {
    if (typeof window === 'undefined') return;

    try {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_WORKSPACE_ID);
    } catch (error) {
        logger.error('Error removing workspace id from localStorage', { error });
    }
}

/**
 * Check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
    if (typeof window === 'undefined') return false;

    try {
        const test = '__localStorage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch {
        return false;
    }
}
