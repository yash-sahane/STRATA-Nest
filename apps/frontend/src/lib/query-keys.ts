/**
 * Query-key classification for the workspace-switch cache reset.
 *
 * This file used to also carry an enumerated WORKSPACE_SCOPED map. It is gone
 * on purpose: nothing read it once `isWorkspaceScopedKey` became a deny-list,
 * so it was an unreferenced list that still READ as authoritative — and it had
 * already drifted (TEAM_ATTENDANCE_ANALYTICS named a query that no longer
 * exists; several newer keys were never added). An unverifiable map that the
 * next author copies a key out of clears nothing at all, which is exactly the
 * failure it claimed to prevent.
 *
 * INVARIANT for what remains: every root below must be the FIRST element of a
 * key some hook actually registers with `useQuery`. React query matches keys
 * element-wise, so a near-miss matches nothing.
 */

export const QUERY_KEYS = {
    // User-scoped queries (persist across workspace switches)
    USER_SCOPED: {
        WORKSPACES: ['workspaces'],
        // Every membership the caller holds, ANYWHERE — the source `useWorkspaceRole`
        // answers from. Keyed on the user, not a workspace, so switching workspaces
        // must not drop it: it is the same answer either side of the switch, and
        // evicting it made every permission-gated control on the destination page
        // flip to "loading" and then re-fetch for no gain.
        MY_MEMBERSHIPS: ['my-memberships'],
        // A person's notifications, keyed on THEM: both notification queries
        // filter by userId alone and never by workspace, so the same rows are
        // correct either side of a switch. Evicting them was not just wasted
        // work — selecting the workspace on page load removed the query while
        // its first request was still in flight, so React Query discarded that
        // response and refetched. That was the duplicate notification request
        // on every single route.
        NOTIFICATIONS: ['notifications'],
    },
} as const;

const USER_SCOPED_ROOTS = new Set<string>(
    Object.values(QUERY_KEYS.USER_SCOPED).map(([root]) => root),
);

/**
 * Whether a cached key holds workspace data and must not survive a switch.
 *
 * Deliberately a deny-list of user-scoped roots rather than an allow-list of
 * workspace-scoped ones: a key added by a hook after this file was last touched
 * then fails CLOSED (dropped, refetched) instead of leaking the previous
 * workspace's rows.
 */
export function isWorkspaceScopedKey(queryKey: readonly unknown[]): boolean {
    return !USER_SCOPED_ROOTS.has(queryKey[0] as string);
}
