/**
 * Shared sidebar item metadata used by both LeftSidebar and MobileNav.
 */
import React from 'react';
import {
  Box, ClipboardList, AlertTriangle, BarChart2, Building2,
  Zap, Archive, Radar, Scan, Globe, Cuboid, LifeBuoy,
} from 'lucide-react';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';

export type ContextLevel = 'global' | 'building' | 'viewer';

export interface SidebarItemMeta {
  icon: React.ElementType;
  color: string;
  label: string;
  type: 'internal' | 'config';
  contexts: ContextLevel[];
}

/** Apps that count as "viewer" context */
export const VIEWER_CONTEXT_APPS = ['native_viewer', 'radar', 'asset_plus', 'viewer', 'assetplus_viewer', 'split_viewer', 'virtual_twin'];

export const SIDEBAR_ITEM_META: Record<string, SidebarItemMeta> = {
  inventory:        { icon: ClipboardList, color: 'text-orange-500',  label: 'Inventory',                          type: 'internal', contexts: ['building', 'viewer'] },
  fault_report:     { icon: AlertTriangle, color: 'text-destructive', label: 'Fault Report',                       type: 'internal', contexts: ['building', 'viewer'] },
  insights:         { icon: BarChart2,     color: 'text-accent',      label: 'Insights',                           type: 'internal', contexts: ['global', 'building', 'viewer'] },
  fma_plus:         { icon: Building2,     color: 'text-primary',     label: DEFAULT_APP_CONFIGS.fma_plus.label,    type: 'config',   contexts: ['global', 'building'] },
  fma_native:       { icon: Building2,     color: 'text-accent',      label: 'FMA 2.0',                            type: 'internal', contexts: ['global', 'building'] },
  asset_plus:       { icon: Box,           color: 'text-primary',     label: DEFAULT_APP_CONFIGS.asset_plus.label,  type: 'config',   contexts: ['building'] },
  iot:              { icon: Zap,           color: 'text-accent',      label: DEFAULT_APP_CONFIGS.iot.label,         type: 'config',   contexts: ['global', 'building'] },
  original_archive: { icon: Archive,       color: 'text-muted-foreground', label: DEFAULT_APP_CONFIGS.original_archive.label, type: 'config', contexts: ['global', 'building'] },
  radar:            { icon: Radar,         color: 'text-primary',     label: DEFAULT_APP_CONFIGS.radar.label,       type: 'config',   contexts: ['building', 'viewer'] },
  ai_scan:          { icon: Scan,          color: 'text-accent',      label: 'AI Scan',                            type: 'internal', contexts: ['building', 'viewer'] },
  globe:            { icon: Globe,         color: 'text-primary',     label: 'Globe',                              type: 'internal', contexts: ['global'] },
  native_viewer:    { icon: Cuboid,        color: 'text-primary',     label: '3D Viewer',                          type: 'internal', contexts: ['building', 'viewer'] },
};

/** Derive the current context level from app state */
export function getCurrentContext(activeApp: string, selectedFacility: unknown): ContextLevel {
  if (VIEWER_CONTEXT_APPS.includes(activeApp)) return 'viewer';
  if (selectedFacility) return 'building';
  return 'global';
}
