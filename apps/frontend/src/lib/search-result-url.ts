import type { SearchResult } from '@/hooks/use-global-search';

/**
 * Where a search hit opens.
 *
 * One function for both search surfaces (the header box and the command
 * palette), which each carried their own copy of this switch.
 *
 * Task and epic hits name their PROJECT as well as the record. Both pages show
 * one project at a time and remember the last one picked, so a bare `?taskId=`
 * was looked up among the remembered project's tasks — and a hit from any other
 * project opened the page and then nothing at all. `/tasks` and `/epics` both
 * honour `?projectId=`, so sending it lands the click on the right board with
 * the record open.
 */
export function searchResultUrl(
  result: Pick<SearchResult, 'type' | 'id' | 'projectId'>,
): string {
  const inProject = result.projectId ? `projectId=${result.projectId}&` : '';
  switch (result.type) {
    case 'task':
      return `/tasks?${inProject}taskId=${result.id}`;
    case 'project':
      return `/projects/${result.id}`;
    case 'epic':
      return `/epics?${inProject}epicId=${result.id}`;
    case 'sprint':
      // /sprints/[id] has no page of its own — only /board, /backlog, /analytics.
      return `/sprints/${result.id}/board`;
    case 'requirement':
      // The 'requirement' corpus is functional_requirements (use-global-search).
      return `/functional-requirements?${inProject}frId=${result.id}`;
    case 'client-requirement':
      return `/requirements?${inProject}crId=${result.id}`;
    default:
      return '/dashboard';
  }
}

/**
 * What each kind of hit is called. Both search surfaces printed the raw type
 * key, so functional requirements were headed "Requirements" — the name this
 * application gives to something else.
 */
const SEARCH_TYPE_LABELS: Record<SearchResult['type'], [singular: string, plural: string]> = {
  task: ['Task', 'Tasks'],
  project: ['Project', 'Projects'],
  epic: ['Epic', 'Epics'],
  sprint: ['Sprint', 'Sprints'],
  requirement: ['Functional requirement', 'Functional requirements'],
  'client-requirement': ['Client requirement', 'Client requirements'],
};

export function searchTypeLabel(type: string, plural = false): string {
  const label = SEARCH_TYPE_LABELS[type as SearchResult['type']];
  return label ? label[plural ? 1 : 0] : type;
}
