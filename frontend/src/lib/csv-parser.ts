/**
 * CSV Parser for bulk user import
 * Validates and parses CSV files containing user data
 */

export interface ParsedUser {
  name: string;
  email: string;
  role: string;
}

const VALID_ROLES = [
  'MANAGER', // Admin level
  'ASSISTANT_MANAGER',
  'SOFTWARE_DEVELOPER',
  'SOFTWARE_DEVELOPER_INTERN',
  'TESTER',
  'CONTENT_ENGINEER',
  'MEMBER',
];

/**
 * Parse CSV file and extract user data
 */
export async function parseCSV(file: File): Promise<ParsedUser[]> {
  const text = await file.text();
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);

  if (lines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row');
  }

  // Parse header
  const header = lines[0].split(',').map(col => col.trim().toLowerCase());
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
    const role = values[roleIndex]?.trim().toUpperCase();

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
    const roleValidation = validateRole(role);
    if (!roleValidation.isValid) {
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
export function validateRole(role: string): { isValid: boolean; error?: string } {
  if (!role) {
    return { isValid: false, error: 'Role is required' };
  }

  if (!VALID_ROLES.includes(role)) {
    return {
      isValid: false,
      error: `Invalid role: ${role}. Valid roles are: ${VALID_ROLES.join(', ')}`,
    };
  }

  return { isValid: true };
}

/**
 * Validate complete user data object
 */
export function validateUserData(user: ParsedUser): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  const emailValidation = validateEmail(user.email);
  if (!emailValidation.isValid) {
    errors.push(emailValidation.error!);
  }

  const roleValidation = validateRole(user.role);
  if (!roleValidation.isValid) {
    errors.push(roleValidation.error!);
  }

  if (!user.name || user.name.trim().length === 0) {
    errors.push('Name is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
