import { BarChart2, Building2, Box, Zap, Archive, Radar, Scan, Globe } from 'lucide-react';
import type { AppConfig } from '@/lib/types';

export const IVION_DEFAULT_BASE_URL = 'https://swg.iv.navvis.com';

export const NORDIC_CITIES = [
    { name: "Stockholm", lat: 59.3293, lng: 18.0686 },
    { name: "Oslo", lat: 59.9139, lng: 10.7522 },
    { name: "Copenhagen", lat: 55.6761, lng: 12.5683 },
    { name: "Helsinki", lat: 60.1699, lng: 24.9384 },
    { name: "Gothenburg", lat: 57.7089, lng: 11.9746 },
    { name: "Malmo", lat: 55.6049, lng: 13.0038 },
    { name: "Bergen", lat: 60.3913, lng: 5.3221 },
    { name: "Aarhus", lat: 56.1629, lng: 10.2039 },
    { name: "Tampere", lat: 61.4978, lng: 23.7610 }
];

export const BUILDING_IMAGES = [
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1516156008625-3a9d60fa1d78?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1554435493-93422e8220c8?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1464938050520-ef2270bb8ce8?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1577495508048-b635879837f1?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1448630360428-65456659e233?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1460317442991-0ec209397118?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1494145904049-0dca59b4bbad?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1487958449943-2429e8be8625?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?q=80&w=600&auto=format&fit=crop",
];

/** Interior / floor-level images used for storey cards */
export const FLOOR_IMAGES = [
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1524758631624-e2822e304c36?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1497215842964-222b430dc094?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1503387762-592deb58ef4e?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1564540586988-aa4e53c3d799?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1462826303086-329426d1aef5?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1497366811353-6870744d04b2?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1562664377-709f2c337eb2?q=80&w=600&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1517502884422-41eaead166d4?q=80&w=600&auto=format&fit=crop",
];

export const THEME_OPTIONS = [
    { value: 'dark', label: 'Dark', colors: ['#000000', '#a78bfa', '#818cf8'] },
    { value: 'light', label: 'Light', colors: ['#f5f3ff', '#7c3aed', '#6366f1'] },
    { value: 'swg', label: 'SWG', colors: ['#141414', '#39a5b5', '#39a5b5'] },
] as const;

export const DEFAULT_APP_CONFIGS: Record<string, AppConfig> = {
    insights: { label: 'Insights', url: '', icon: BarChart2, openMode: 'internal', username: '', password: '' },
    fma_plus: { label: 'FMA+', url: 'https://swg-demo.bim.cloud/', icon: Building2, openMode: 'internal', username: '', password: '' },
    asset_plus: { label: 'Asset+', url: '', icon: Box, openMode: 'internal', username: '', password: '' },
    iot: { label: 'IoT+', url: 'https://swg-demo.bim.cloud/iot', icon: Zap, openMode: 'internal', username: '', password: '', pollIntervalHours: 24 },
    original_archive: { label: 'OA+', url: '', icon: Archive, openMode: 'internal', username: '', password: '' },
    radar: { label: '360+', url: 'https://swg.iv.navvis.com', icon: Radar, openMode: 'external', username: '', password: '' },
    ai_scan: { label: 'AI Scan', url: '', icon: Scan, openMode: 'internal', username: '', password: '' },
    globe: { label: 'Globe', url: '', icon: Globe, openMode: 'internal', username: '', password: '' },
};

export interface SidebarItem {
    id: string;
    hasDividerAfter: boolean;
}

export const DEFAULT_SIDEBAR_ORDER: SidebarItem[] = [
    { id: 'native_viewer', hasDividerAfter: false },
    { id: 'inventory', hasDividerAfter: false },
    { id: 'ai_scan', hasDividerAfter: false },
    { id: 'fault_report', hasDividerAfter: false },
    { id: 'support', hasDividerAfter: false },
    { id: 'insights', hasDividerAfter: true },
    { id: 'fma_plus', hasDividerAfter: false },
    { id: 'fma_native', hasDividerAfter: false },
    { id: 'asset_plus', hasDividerAfter: false },
    { id: 'iot', hasDividerAfter: false },
    { id: 'original_archive', hasDividerAfter: false },
    { id: 'radar', hasDividerAfter: false },
    { id: 'globe', hasDividerAfter: false },
];

export const SIDEBAR_ORDER_STORAGE_KEY = 'sidebar-app-order';
export const SIDEBAR_SETTINGS_CHANGED_EVENT = 'sidebar-settings-changed';

export const SENSLINC_POLL_OPTIONS = [
    { value: 1, label: '1 hour' },
    { value: 6, label: '6 hours' },
    { value: 12, label: '12 hours' },
    { value: 24, label: '24 hours (recommended)' },
    { value: 48, label: '48 hours' },
    { value: 0, label: 'Manual (no automatic polling)' },
];
