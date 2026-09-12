import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query as apiQuery } from '@/lib/api/client';
import type { Task, Project, Epic, Sprint } from '@/types';
import { logger } from '@/lib/logger';

export interface SearchResult {
  id: string;
  type: 'task' | 'project' | 'epic' | 'sprint' | 'requirement';
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  hierarchyId?: string;
  projectId?: string;
  projectName?: string;
  createdAt?: string;
  /**
   * Ranking signal only. It is a SUM over the matched fields, with a per-type
   * boost on top, so it is unbounded above 100 and must never be rendered as a
   * percentage — that is what produced "Match: 270%".
   */
  relevanceScore: number;
  /**
   * The strongest single-field match, 0-100, and the only one of the two that is
   * meaningful as a percentage: 100 exact, 90 the field starts with the query,
   * 70 the field contains it, at most 60 for a scattered fuzzy match.
   */
  matchStrength: number;
  matchedFields: string[];
}

// Fuzzy match scoring function
function fuzzyScore(text: string, query: string): number {
  if (!text || !query) return 0;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match gets highest score
  if (textLower === queryLower) return 100;

  // Starts with query gets high score
  if (textLower.startsWith(queryLower)) return 90;

  // Contains query gets good score
  if (textLower.includes(queryLower)) return 70;

  // Fuzzy character matching
  let score = 0;
  let queryIndex = 0;
  let consecutiveMatches = 0;

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      score += 10 + consecutiveMatches * 5; // Bonus for consecutive matches
      consecutiveMatches++;
      queryIndex++;
    } else {
      consecutiveMatches = 0;
    }
  }

  // Return 0 if not all characters matched
  if (queryIndex < queryLower.length) return 0;

  return Math.min(score, 60); // Cap fuzzy score at 60
}

// Search in text and return score + matched fields
function searchInFields(
  fields: { name: string; value: string }[],
  query: string
): { score: number; best: number; matchedFields: string[] } {
  let totalScore = 0;
  // The best single field, kept separately: summing is how you rank, not how you
  // express a percentage.
  let best = 0;
  const matchedFields: string[] = [];

  fields.forEach(({ name, value }) => {
    const score = fuzzyScore(value, query);
    if (score > 0) {
      totalScore += score;
      if (score > best) best = score;
      matchedFields.push(name);
    }
  });

  return { score: totalScore, best, matchedFields };
}

interface SearchCorpus {
  tasks: Task[];
  projects: Project[];
  epics: Epic[];
  sprints: Sprint[];
  requirements: any[];
}

/**
 * Load the full searchable corpus for a workspace. Uses `listAll` so search
 * covers every record, not just the first page — a workspace with more than a
 * page of tasks/projects would otherwise silently hide the rest from search.
 * Keyed by workspace (not by query term) so it is fetched once and reused while
 * the user refines their search client-side.
 */
async function fetchSearchCorpus(workspaceId: string): Promise<SearchCorpus> {
  const scope = [apiQuery.equal('workspaceId', workspaceId)];
  try {
    const [tasks, projects, epics, sprints] = await Promise.all([
      resources.listAll<Task>('tasks', scope),
      resources.listAll<Project>('projects', scope),
      resources.listAll<Epic>('epics', scope),
      resources.listAll<Sprint>('sprints', scope),
    ]);

    let requirements: any[] = [];
    try {
      // Requirements collection might not exist in all setups.
      requirements = (await resources.listAll<any>('functional_requirements', scope)).items;
    } catch (error) {
      logger.warn('Requirements collection not found', { error });
    }

    return {
      tasks: tasks.items,
      projects: projects.items,
      epics: epics.items,
      sprints: sprints.items,
      requirements,
    };
  } catch (error) {
    logger.error('Global search error', { error });
    return { tasks: [], projects: [], epics: [], sprints: [], requirements: [] };
  }
}

/** Score and rank the corpus against a search term. Pure + client-side. */
function scoreCorpus(corpus: SearchCorpus, searchQuery: string): SearchResult[] {
  const results: SearchResult[] = [];

  corpus.tasks.forEach((task) => {
    const { score, best, matchedFields } = searchInFields(
      [
        { name: 'title', value: task.title || '' },
        { name: 'description', value: task.description || '' },
        { name: 'hierarchyId', value: task.hierarchyId || '' },
      ],
      searchQuery
    );
    if (score > 0) {
      results.push({
        id: task.id,
        type: 'task',
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        hierarchyId: task.hierarchyId,
        projectId: task.projectId,
        createdAt: task.createdAt,
        relevanceScore: score,
        matchStrength: best,
        matchedFields,
      });
    }
  });

  corpus.projects.forEach((project) => {
    const { score, best, matchedFields } = searchInFields(
      [
        { name: 'name', value: project.name || '' },
        { name: 'description', value: project.description || '' },
        { name: 'shortCode', value: project.shortCode || '' },
      ],
      searchQuery
    );
    if (score > 0) {
      results.push({
        id: project.id,
        type: 'project',
        title: project.name,
        description: project.description,
        status: project.status,
        createdAt: project.createdAt,
        relevanceScore: score * 1.2, // Boost project results slightly
        matchStrength: best,
        matchedFields,
      });
    }
  });

  corpus.epics.forEach((epic) => {
    const { score, best, matchedFields } = searchInFields(
      [
        { name: 'name', value: epic.name || '' },
        { name: 'description', value: epic.description || '' },
        // Epics carry a hierarchyId ('EP-001') too, and both result lists render
        // it — searching and emitting it keeps epic rows consistent with tasks.
        { name: 'hierarchyId', value: epic.hierarchyId || '' },
      ],
      searchQuery
    );
    if (score > 0) {
      results.push({
        id: epic.id,
        type: 'epic',
        title: epic.name,
        description: epic.description,
        status: epic.status,
        hierarchyId: epic.hierarchyId,
        projectId: epic.projectId,
        createdAt: epic.createdAt,
        relevanceScore: score * 1.1,
        matchStrength: best,
        matchedFields,
      });
    }
  });

  corpus.sprints.forEach((sprint) => {
    const { score, best, matchedFields } = searchInFields(
      [
        { name: 'name', value: sprint.name || '' },
        { name: 'goal', value: sprint.goal || '' },
      ],
      searchQuery
    );
    if (score > 0) {
      results.push({
        id: sprint.id,
        type: 'sprint',
        title: sprint.name,
        description: sprint.goal,
        status: sprint.status,
        projectId: sprint.projectId,
        createdAt: sprint.createdAt,
        relevanceScore: score,
        matchStrength: best,
        matchedFields,
      });
    }
  });

  corpus.requirements.forEach((doc: any) => {
    const { score, best, matchedFields } = searchInFields(
      [
        { name: 'title', value: doc.title || '' },
        { name: 'description', value: doc.description || '' },
        // `hierarchyId` ('FR-001'), NOT `requirementId`: the functional
        // requirement contract has no such field (requirements/mappers.ts), so
        // the old name always scored 0 and an FR could never be found by its
        // code — the one thing users actually type into this box.
        { name: 'hierarchyId', value: doc.hierarchyId || '' },
      ],
      searchQuery
    );
    if (score > 0) {
      results.push({
        id: doc.id,
        type: 'requirement',
        title: doc.title,
        description: doc.description,
        status: doc.status,
        priority: doc.priority,
        // Both result lists render `hierarchyId` as the leading code badge
        // (command-palette.tsx, header.tsx); without it FR rows showed none.
        hierarchyId: doc.hierarchyId,
        projectId: doc.projectId,
        createdAt: doc.createdAt,
        relevanceScore: score,
        matchStrength: best,
        matchedFields,
      });
    }
  });

  // Sort by relevance score (highest first)
  return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export function useGlobalSearch(query: string, workspaceId?: string) {
  const trimmed = query.trim();
  const active = !!workspaceId && trimmed.length >= 2;

  // The corpus is fetched once per workspace (only after a real search starts)
  // and cached; refining the term re-filters in memory without refetching.
  const corpusQuery = useQuery({
    queryKey: ['global-search-corpus', workspaceId],
    queryFn: () => fetchSearchCorpus(workspaceId as string),
    enabled: active,
    staleTime: 30000, // Cache for 30 seconds
  });

  const data = useMemo<SearchResult[]>(() => {
    if (!active || !corpusQuery.data) return [];
    return scoreCorpus(corpusQuery.data, trimmed);
  }, [active, corpusQuery.data, trimmed]);

  return { ...corpusQuery, data };
}
