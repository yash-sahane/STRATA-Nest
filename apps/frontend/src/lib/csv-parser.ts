/**
 * CSV Parser for bulk user import
 * Validates and parses CSV files containing user data
 */

import { BUILT_IN_ROLES } from '@/lib/permissions';

export interface ParsedUser {
  name: string;
  email: string;
  role: string;
}

// Derived from the single source of truth (BUILT_IN_ROLES in lib/permissions)
// so bulk-import role validation can never drift from the roles the permission
// system actually defines. Add a role there and CSV import accepts it too.
const VALID_ROLES: readonly string[] = BUILT_IN_ROLES;

/**
 * The role a CSV cell names, as a membership stores it — or null.
 *
 * A built-in is its key in any letter case (`manager` is MANAGER). A custom role
 * is matched on its name, also in any case, and returned as the workspace spells
 * it: the cell used to be upper-cased before it was checked, so a workspace's own
 * "Release Captain" could never be imported even once it existed.
 */
function resolveRole(cell: string, customRoles: readonly string[]): string | null {
  const upper = cell.toUpperCase();
  if (VALID_ROLES.includes(upper)) return upper;
  const lower = cell.toLowerCase();
  return customRoles.find((name) => name.toLowerCase() === lower) ?? null;
}

/**
 * Parse CSV file and extract user data.
 *
 * `customRoles` are the names of the workspace's own roles, accepted in the
 * `role` column alongside the built-in keys.
 */
export async function parseCSV(
  file: File,
  customRoles: readonly string[] = []
): Promise<ParsedUser[]> {
  // Strip the UTF-8 BOM Excel writes: with it, the first header cell reads
  // U+FEFF + "name" instead of "name", so a perfectly valid export failed with
  // "Missing required columns: name".
  const text = (await file.text()).replace(/^\uFEFF/, '');
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);

  if (lines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row');
  }

  // Parse header with the same quote-aware splitter as the data rows.
  const header = parseCSVLine(lines[0]).map(col => col.toLowerCase());
  const requiredColumns = ['name', 'email', 'role'];
  
  // Validate required columns exist
  const missingColumns = requiredColumns.filter(col => !header.includes(col));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
  }

  // Get column indices
  const nameIndex = header.indexOf('name');
  const emailIndex = header.indexOf('email');
  const roleIndex = header.indexOf('role');

  const users: ParsedUser[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = parseCSVLine(line);

    if (values.length < requiredColumns.length) {
      errors.push(`Row ${i + 1}: Insufficient columns`);
      continue;
    }

    const name = values[nameIndex]?.trim();
    const email = values[emailIndex]?.trim().toLowerCase();
    const roleCell = values[roleIndex]?.trim() ?? '';

    // Validate name
    if (!name) {
      errors.push(`Row ${i + 1}: Name is required`);
      continue;
    }

    // Validate email
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      errors.push(`Row ${i + 1}: ${emailValidation.error}`);
      continue;
    }

    // Check for duplicate emails in CSV
    if (seenEmails.has(email)) {
      errors.push(`Row ${i + 1}: Duplicate email ${email}`);
      continue;
    }
    seenEmails.add(email);

    // Validate role
    const roleValidation = validateRole(roleCell, customRoles);
    const role = resolveRole(roleCell, customRoles);
    if (!roleValidation.isValid || !role) {
      errors.push(`Row ${i + 1}: ${roleValidation.error}`);
      continue;
    }

    users.push({
      name,
      email,
      role,
    });
  }

  if (errors.length > 0) {
    throw new Error(`CSV validation failed:\n${errors.join('\n')}`);
  }

  if (users.length === 0) {
    throw new Error('No valid users found in CSV file');
  }

  return users;
}

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Validate email format
 */
export function validateEmail(email: string): { isValid: boolean; error?: string } {
  if (!email) {
    return { isValid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: `Invalid email format: ${email}` };
  }

  return { isValid: true };
}

/**
 * Validate role
 */
export function validateRole(
  role: string,
  customRoles: readonly string[] = []
): { isValid: boolean; error?: string } {
  if (!role) {
    return { isValid: false, error: 'Role is required' };
  }

  if (!resolveRole(role, customRoles)) {
    return {
      isValid: false,
      error: `Invalid role: ${role}. Valid roles are: ${[...VALID_ROLES, ...customRoles].join(', ')}`,
    };
  }

  return { isValid: true };
}

