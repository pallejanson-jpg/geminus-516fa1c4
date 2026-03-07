import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize a GUID for consistent comparison: lowercase, no dashes.
 */
export function normalizeGuid(value?: string | null): string {
  return (value || '').toLowerCase().replace(/-/g, '');
}
