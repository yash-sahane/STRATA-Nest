import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Generate project code from name
export function generateProjectCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'PRJ';

  let code = '';

  if (words.length === 1) {
    const w = words[0].replace(/[^a-zA-Z0-9]/g, '');
    code = w.substring(0, 3).toUpperCase();
    // Pad by repeating the last character if too short
    while (code.length < 3) {
      code += code[code.length - 1] || 'X';
    }
  } else if (words.length === 2) {
    code = (words[0].substring(0, 2) + words[1].substring(0, 1)).toUpperCase();
    if (code.length < 3) code += words[0][0]?.toUpperCase() || 'X';
  } else {
    code = words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
  }

  return code.substring(0, 3);
}

// Format date
export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Get initials from name
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
