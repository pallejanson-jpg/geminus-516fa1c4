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

/**
 * Room list/picker label combining room number (assets.name) and room name
 * (assets.common_name) — e.g. "7-F8-12 · SOSIAL SONE". Falls back gracefully
 * when either field is missing or the two are identical (common_name often
 * mirrors name when no separate room name was set upstream).
 */
export function formatRoomLabel(roomNumber?: string | null, roomName?: string | null): string {
  const number = (roomNumber || '').trim();
  const name = (roomName || '').trim();
  if (number && name && number !== name) return `${number} · ${name}`;
  return number || name;
}
