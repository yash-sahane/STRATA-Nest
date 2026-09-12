// Gemini AI configuration is handled by the API route
// See: /src/app/api/ai-generate/route.ts

import { logger } from '@/lib/logger';

export interface GeneratedClientRequirement {
  title: string;
  clientName: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface GeneratedFunctionalRequirement {
  title: string;
  description: string;
  type: 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'TECHNICAL' | 'BUSINESS';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  acceptanceCriteria: string[];
  businessRules: string[];
  parentId?: string; // Reference to parent FR for nesting
}

export interface GeneratedEpic {
  name: string;
  description: string;
  color: string;
  startDate?: string;
  endDate?: string;
  functionalRequirementIds: string[]; // References to FRs
}

export interface GeneratedTask {
  title: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedHours: number;
  epicId?: string; // Reference to Epic
  labels: string[];
}

export interface DocumentAnalysis {
  summary: string;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  estimatedDuration: string;
  recommendedTeamSize: number;
}

export interface GeneratedHierarchy {
  analysis: DocumentAnalysis;
  clientRequirements: GeneratedClientRequirement[];
  functionalRequirements: GeneratedFunctionalRequirement[];
  epics: GeneratedEpic[];
  tasks: GeneratedTask[];
  timeline: {
    projectDuration: string;
    milestones: Array<{
      name: string;
      date: string;
      description: string;
    }>;
  };
}

/**
 * Call AI via Next.js API route (supports HuggingFace + Gemini fallback)
 */
/**
 * Slightly longer than the route's own TOTAL_TIMEOUT_MS (90s), so a route that
 * times out cleanly gets to say so — and a route that does not settle at all
 * still cannot leave the dialog waiting forever. Without this the generate
 * dialog sat at 90% with no cancel and nothing to distinguish a slow model from
 * a hung one.
 */
const AI_REQUEST_TIMEOUT_MS = 100_000;

async function callAI(prompt: string, maxRetries = 3, workspaceId?: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/ai-generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        maxRetries,
        // The route checks the caller holds requirement:write HERE before it
        // spends the operator's model quota, so it has to be told where "here" is.
        workspaceId,
      }),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout surfaces as an AbortError, whose default message ("signal is
    // aborted without reason") tells the user nothing at all.
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(
        `Generation timed out after ${Math.round(AI_REQUEST_TIMEOUT_MS / 1000)}s. ` +
          'The model provider did not respond — try again, or with a shorter document.',
      );
    }
    throw error;
  }

  if (!response.ok) {
    // The route answers 401 when the session has expired; a non-JSON body (a
    // proxy's HTML error page) used to throw a SyntaxError over the real reason.
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || `Failed to generate AI response (${response.status})`);
  }

  const data = await response.json();
  return data.text;
}

// Single optimized prompt that generates everything in one call
const UNIFIED_GENERATION_PROMPT = `You are an expert software requirements analyst. Analyze the document and generate a complete project structure in ONE response.

Output a JSON object with these sections:
1. "analysis" - Document summary and project assessment
2. "clientRequirements" - High-level business needs (2-5 items)
3. "functionalRequirements" - Technical specifications (5-15 items)
4. "epics" - Feature groupings (3-8 items)
5. "tasks" - Implementation work items (10-30 items)
6. "timeline" - Project milestones

JSON Schema:
{
  "analysis": {
    "summary": "2-3 sentence project summary",
    "complexity": "LOW|MEDIUM|HIGH|VERY_HIGH",
    "estimatedDuration": "e.g. 3 months",
    "recommendedTeamSize": number
  },
  "clientRequirements": [{
    "title": "string",
    "clientName": "extract from doc or 'Client'",
    "description": "string",
    "priority": "LOW|MEDIUM|HIGH|CRITICAL"
  }],
  "functionalRequirements": [{
    "title": "string",
    "description": "string",
    "type": "FUNCTIONAL|TECHNICAL|BUSINESS",
    "priority": "LOW|MEDIUM|HIGH|CRITICAL",
    "complexity": "LOW|MEDIUM|HIGH|VERY_HIGH",
    "acceptanceCriteria": ["string"],
    "businessRules": ["string"]
  }],
  "epics": [{
    "name": "string",
    "description": "string",
    "color": "#hex",
    "functionalRequirementIds": []
  }],
  "tasks": [{
    "title": "string",
    "description": "string",
    "priority": "LOW|MEDIUM|HIGH|CRITICAL",
    "estimatedHours": number (2-16),
    "epicId": "epic index as string",
    "labels": ["string"]
  }],
  "timeline": {
    "projectDuration": "string",
    "milestones": [{"name": "string", "date": "YYYY-MM-DD", "description": "string"}]
  }
}

Rules:
- Output ONLY valid JSON, no markdown
- Be concise but comprehensive
- Use realistic estimates
- Link tasks to epics using index (0, 1, 2...)`;

/**
 * Generate complete project hierarchy in a SINGLE AI call
 * This is the optimized version that saves tokens
 */
export async function generateProjectHierarchyUnified(
  documentText: string,
  // The route checks requirement:write in THIS workspace before spending the
  // operator's model quota, so the caller has to say which one it is authoring
  // into.
  workspaceId?: string
): Promise<GeneratedHierarchy> {
  try {
    // Truncate very long input text to save tokens (keep first 8000 chars)
    const truncatedDoc =
      documentText.length > 8000
        ? documentText.substring(0, 8000) + '\n...[document truncated for processing]'
        : documentText;

    const prompt = `${UNIFIED_GENERATION_PROMPT}\n\nDocument:\n${truncatedDoc}`;

    let text = await callAI(prompt, 3, workspaceId);

    // Clean up response - remove markdown code blocks if present
    text = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    const generated: GeneratedHierarchy = JSON.parse(text);

    // Validate required fields exist
    if (!generated.analysis) {
      generated.analysis = {
        summary: 'Project analysis',
        complexity: 'MEDIUM',
        estimatedDuration: '3 months',
        recommendedTeamSize: 3,
      };
    }

    // Array.isArray, not a truthiness check: the model sometimes answers with an
    // object (or a string) for a section, and every consumer downstream — the
    // preview's .map, bulk-save's for-loops — assumes an array.
    if (!Array.isArray(generated.clientRequirements)) generated.clientRequirements = [];
    if (!Array.isArray(generated.functionalRequirements)) generated.functionalRequirements = [];
    if (!Array.isArray(generated.epics)) generated.epics = [];
    if (!Array.isArray(generated.tasks)) generated.tasks = [];
    if (!generated.timeline) {
      generated.timeline = {
        projectDuration: generated.analysis.estimatedDuration || '3 months',
        milestones: [],
      };
    }

    return generated;
  } catch (error: unknown) {
    logger.error('AI Generation Error', { error });
    throw new Error(
      `Failed to generate project hierarchy: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}


