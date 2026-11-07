import { useEffect, useRef } from 'react';

/** Where the last project somebody picked is remembered, across pages. */
const STORAGE_KEY = 'selected-project-id';

const remembered = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * Make `projectId` the one every project-scoped page opens on — for a page that
 * IS a project (its overview), and so picks none from a list.
 */
export function rememberSelectedProject(projectId: string): void {
  remember(projectId);
}

const remember = (projectId: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, projectId);
  } catch {
    // Storage can be unavailable (private window); the choice just isn't kept.
  }
};

/**
 * Keeps a page's selected project VALID for the list it is choosing from.
 *
 * Four pages each carried a copy of this effect, and the copies shared two
 * faults:
 *
 *  - They only ever picked a project when none was selected. Switch workspace
 *    and the old workspace's project stayed selected — the header named the
 *    new workspace, the picker went blank, and the list underneath went on
 *    showing (and letting you edit) the other workspace's sprints.
 *
 *  - Two of them re-applied `?projectId=` from the URL on every run, so after
 *    arriving by a link the picker snapped back the moment you chose
 *    something else.
 *
 * In order: a deep link is honoured once per value; a selection that is still
 * in the list is left alone; otherwise the remembered project if THIS list has
 * it and it is not archived, else the first that is not, else none.
 */
export function useProjectSelectionSync({
  projects,
  urlProjectId,
  selectedProjectId,
  setSelectedProjectId,
}: {
  projects: ReadonlyArray<{ id: string; status?: string }>;
  /** `?projectId=` when the page takes one. */
  urlProjectId?: string | null;
  selectedProjectId: string;
  setSelectedProjectId: (projectId: string) => void;
}): void {
  const lastAppliedUrl = useRef<string | null>(null);

  useEffect(() => {
    const listed = (id: string | null | undefined): id is string =>
      Boolean(id) && projects.some((project) => project.id === id);

    if (urlProjectId && urlProjectId !== lastAppliedUrl.current && listed(urlProjectId)) {
      lastAppliedUrl.current = urlProjectId;
      remember(urlProjectId);
      if (urlProjectId !== selectedProjectId) setSelectedProjectId(urlProjectId);
      return;
    }

    if (listed(selectedProjectId)) return;

    // Not an archived one: those are opened by a link, never landed on.
    const inPlay = (id: string | null | undefined): id is string =>
      Boolean(id) && projects.some((project) => project.id === id && project.status !== 'ARCHIVED');
    const saved = remembered();
    const next = inPlay(saved) ? saved : (projects.find((project) => project.status !== 'ARCHIVED')?.id ?? '');
    if (next) remember(next);
    if (next !== selectedProjectId) setSelectedProjectId(next);
  }, [projects, urlProjectId, selectedProjectId, setSelectedProjectId]);
}
