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
  relevanceScore: number;
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
): { score: number; matchedFields: string[] } {
  let totalScore = 0;
  const matchedFields: string[] = [];

  fields.forEach(({ name, value }) => {
    const score = fuzzyScore(value, query);
    if (score > 0) {
      totalScore += score;
      matchedFields.push(name);
    }
  });

  return { score: totalScore, matchedFields };
}

export function useGlobalSearch(query: string, workspaceId?: string) {
  return useQuery({
    queryKey: ['global-search', query, workspaceId],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!query || query.trim().length < 2 || !workspaceId) {
        return [];
      }

      const searchQuery = query.trim();
      const results: SearchResult[] = [];

      try {
        // Search Tasks
        const tasksResponse = await resources.list('tasks', [
          apiQuery.equal('workspaceId', workspaceId),
          apiQuery.limit(100),
        ]
        );

        tasksResponse.items.forEach((doc) => {
          const task = doc as unknown as Task;
          const { score, matchedFields } = searchInFields(
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
              matchedFields,
            });
          }
        });

        // Search Projects
        const projectsResponse = await resources.list('projects', [
          apiQuery.equal('workspaceId', workspaceId),
          apiQuery.limit(50),
        ]
        );

        projectsResponse.items.forEach((doc) => {
          const project = doc as unknown as Project;
          const { score, matchedFields } = searchInFields(
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
              matchedFields,
            });
          }
        });

        // Search Epics
        const epicsResponse = await resources.list('epics', [
          apiQuery.equal('workspaceId', workspaceId),
          apiQuery.limit(50),
        ]
        );

        epicsResponse.items.forEach((doc) => {
          const epic = doc as unknown as Epic;
          const { score, matchedFields } = searchInFields(
            [
              { name: 'name', value: epic.name || '' },
              { name: 'description', value: epic.description || '' },
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
              projectId: epic.projectId,
              createdAt: epic.createdAt,
              relevanceScore: score * 1.1,
              matchedFields,
            });
          }
        });

        // Search Sprints
        const sprintsResponse = await resources.list('sprints', [
          apiQuery.equal('workspaceId', workspaceId),
          apiQuery.limit(50),
        ]
        );

        sprintsResponse.items.forEach((doc) => {
          const sprint = doc as unknown as Sprint;
          const { score, matchedFields } = searchInFields(
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
              matchedFields,
            });
          }
        });

        // Search Requirements
        try {
          const requirementsResponse = await resources.list('functional_requirements', [
            apiQuery.equal('workspaceId', workspaceId),
            apiQuery.limit(50),
          ]
          );

          requirementsResponse.items.forEach((doc: any) => {
            const { score, matchedFields } = searchInFields(
              [
                { name: 'title', value: doc.title || '' },
                { name: 'description', value: doc.description || '' },
                { name: 'requirementId', value: doc.requirementId || '' },
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
                projectId: doc.projectId,
                createdAt: doc.createdAt,
                relevanceScore: score,
                matchedFields,
              });
            }
          });
        } catch (error) {
          // Requirements collection might not exist in all setups
          logger.warn('Requirements collection not found', { error });
        }

        // Sort by relevance score (highest first)
        return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      } catch (error) {
        logger.error('Global search error', { error });
        return [];
      }
    },
    enabled: !!workspaceId && query.trim().length >= 2,
    staleTime: 30000, // Cache for 30 seconds
  });
}

