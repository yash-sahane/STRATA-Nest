/**
 * Utility functions for generating hierarchical IDs
 *
 * NEW Format: {ProjectCode}-{CRCode}-{EpicCode}-{FRCode}-{Number}
 * Example: PTES-RAU-EAU-FRL-01
 *
 * Structure:
 * - {ProjectCode} = Project short code (e.g., PTES)
 * - {CRCode} = Client Requirement code - first 3 chars of name (e.g., RAU from "Requirement Auto")
 * - {EpicCode} = Epic code - first 3 chars of name (e.g., EAU from "Epic Auto")
 * - {FRCode} = FR code - first 3 chars of name (e.g., FRL from "FR Login")
 * - {Number} = Sequence number (01, 02, etc.)
 *
 * This format allows reusing the same requirements/modules across related tasks.
 */

/**
 * Extract first N alphabetic characters from a string
 */
function extractChars(text: string, count: number): string {
  if (!text) return '';
  // Remove special characters and numbers, take first N chars, uppercase
  const cleaned = text.replace(/[^a-zA-Z]/g, '');
  return cleaned.slice(0, count).toUpperCase();
}

/**
 * Generate functional requirement hierarchical id
 * Format: {ProjectCode}-{CRCode}-{EpicCode}-{FRCode}-{Number}
 * Example: "PTES-RAU-EAU-FRL-01"
 *
 * This format links FR to its parent CR and Epic for better traceability.
 */
export function generateFRId(
  projectCode: string,
  projectName: string,
  requirementName: string,
  epicName: string,
  frName: string,
  sequenceNumber: number
): string {
  const projCode = projectCode || extractChars(projectName, 4);
  const reqCode = extractChars(requirementName, 3);
  const epicCode = extractChars(epicName, 3);
  const frCode = extractChars(frName, 3);
  const seqNum = sequenceNumber.toString().padStart(2, '0');
  return `${projCode}-${reqCode}-${epicCode}-${frCode}-${seqNum}`;
}

/**
 * Generate FR id when only epic exists (no requirement)
 * Format: {ProjectCode}-{EpicCode}-{FRCode}-{Number}
 * Example: "PTES-EAU-FRL-01"
 */
export function generateFRIdWithEpicOnly(
  projectCode: string,
  projectName: string,
  epicName: string,
  frName: string,
  sequenceNumber: number
): string {
  const projCode = projectCode || extractChars(projectName, 4);
  const epicCode = extractChars(epicName, 3);
  const frCode = extractChars(frName, 3);
  const seqNum = sequenceNumber.toString().padStart(2, '0');
  return `${projCode}-${epicCode}-${frCode}-${seqNum}`;
}

/**
 * Generate FR id when no epic or requirement
 * Format: {ProjectCode}-{FRCode}-{Number}
 * Example: "PTES-FRL-01"
 */
export function generateFRIdStandalone(
  projectCode: string,
  projectName: string,
  frName: string,
  sequenceNumber: number
): string {
  const projCode = projectCode || extractChars(projectName, 4);
  const frCode = extractChars(frName, 3);
  const seqNum = sequenceNumber.toString().padStart(2, '0');
  return `${projCode}-${frCode}-${seqNum}`;
}

/**
 * Generate task hierarchical id
 * Format: {FRId}-{TaskCode}-{Number}
 * Example: "PTES-RAU-EAU-FRL-01-LOG-01" (Task "Login" under FR)
 *
 * This format links task to its parent FR for better traceability.
 */
export function generateTaskId(
  frHierarchyId: string,
  _sprintName: string,
  taskName: string,
  sequenceNumber: number
): string {
  const taskCode = extractChars(taskName, 3) || sequenceNumber.toString().padStart(2, '0');
  const seqNum = sequenceNumber.toString().padStart(2, '0');
  return `${frHierarchyId}-${taskCode}-${seqNum}`;
}

/**
 * Generate task id when no FR
 * Format: {ProjectCode}-{TaskCode}-{Number}
 * Example: "PTES-LOG-01"
 */
export function generateTaskIdWithoutFR(
  projectCode: string,
  projectName: string,
  _sprintName: string,
  taskName: string,
  sequenceNumber: number
): string {
  const projCode = projectCode || extractChars(projectName, 4);
  const taskCode = extractChars(taskName, 3) || sequenceNumber.toString().padStart(2, '0');
  const seqNum = sequenceNumber.toString().padStart(2, '0');
  return `${projCode}-${taskCode}-${seqNum}`;
}
