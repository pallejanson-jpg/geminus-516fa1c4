/**
 * Shared sidebar item metadata used by both LeftSidebar and MobileNav.
 */
import React from 'react';
import {
  Box, ClipboardList, AlertTriangle, BarChart2, Building2,
  Zap, Archive, Radar, Scan, Globe, Cuboid,
} from 'lucide-react';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';

export interface SidebarItemMeta {
  icon: React.ElementType;
  color: string;
  label: string;
  type: 'internal' | 'config';
}

export const SIDEBAR_ITEM_META: Record<string, SidebarItemMeta> = {
  inventory:        { icon: ClipboardList, color: 'text-orange-500',  label: 'Inventory',                          type: 'internal' },
  fault_report:     { icon: AlertTriangle, color: 'text-destructive', label: 'Fault Report',                       type: 'internal' },
  insights:         { icon: BarChart2,     color: 'text-accent',      label: 'Insights',                           type: 'internal' },
  fma_plus:         { icon: Building2,     color: 'text-primary',     label: DEFAULT_APP_CONFIGS.fma_plus.label,    type: 'config' },
  asset_plus:       { icon: Box,           color: 'text-primary',     label: DEFAULT_APP_CONFIGS.asset_plus.label,  type: 'config' },
  iot:              { icon: Zap,           color: 'text-accent',      label: DEFAULT_APP_CONFIGS.iot.label,         type: 'config' },
  original_archive: { icon: Archive,       color: 'text-muted-foreground', label: DEFAULT_APP_CONFIGS.original_archive.label, type: 'config' },
  radar:            { icon: Radar,         color: 'text-primary',     label: DEFAULT_APP_CONFIGS.radar.label,       type: 'config' },
  ai_scan:          { icon: Scan,          color: 'text-accent',      label: 'AI Scan',                            type: 'internal' },
  globe:            { icon: Globe,         color: 'text-primary',     label: 'Globe',                              type: 'internal' },
  native_viewer:    { icon: Cuboid,        color: 'text-primary',     label: '3D Viewer',                          type: 'internal' },
};
