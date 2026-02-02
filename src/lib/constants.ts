import { BarChart2, Building2, Box, Zap, Archive, Radar } from 'lucide-react';

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
    "https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=600&auto=format&fit=crop"
];

export const THEMES: Record<string, Record<string, string>> = {
    dark: {
        bg: 'bg-background', 
        bgSec: 'bg-card', 
        border: 'border-border',
        text: 'text-foreground', 
        textSec: 'text-muted-foreground', 
        accent: 'text-primary',
        card: 'bg-card', 
        input: 'bg-input', 
        hover: 'hover:bg-muted'
    },
    light: {
        bg: 'bg-background', 
        bgSec: 'bg-card', 
        border: 'border-border',
        text: 'text-foreground', 
        textSec: 'text-muted-foreground', 
        accent: 'text-primary',
        card: 'bg-card', 
        input: 'bg-input', 
        hover: 'hover:bg-muted'
    },
    swg: {
        bg: 'bg-background', 
        bgSec: 'bg-card', 
        border: 'border-border',
        text: 'text-foreground', 
        textSec: 'text-muted-foreground', 
        accent: 'text-primary',
        card: 'bg-card', 
        input: 'bg-input', 
        hover: 'hover:bg-muted'
    }
};

export const THEME_OPTIONS = [
    { value: 'dark', label: 'Dark', colors: ['#000000', '#a78bfa', '#818cf8'] },
    { value: 'light', label: 'Light', colors: ['#f5f3ff', '#7c3aed', '#6366f1'] },
    { value: 'swg', label: 'SWG', colors: ['#141414', '#39a5b5', '#39a5b5'] },
] as const;

export const DEFAULT_APP_CONFIGS: Record<string, any> = {
    insights: { label: 'Insights', url: '', icon: BarChart2, openMode: 'internal', username: '', password: '' },
    fma_plus: { label: 'FMA+', url: 'https://swg-demo.bim.cloud/', icon: Building2, openMode: 'external', username: '', password: '' },
    asset_plus: { label: 'Asset+', url: '', icon: Box, openMode: 'internal', username: '', password: '' },
    iot: { label: 'Sensor Dashboard', url: 'https://swg-demo.bim.cloud/iot', icon: Zap, openMode: 'internal', username: '', password: '', pollIntervalHours: 24 },
    original_archive: { label: 'OA+', url: '', icon: Archive, openMode: 'internal', username: '', password: '' },
    radar: { label: '360+ (Ivion)', url: 'https://ivion.se', icon: Radar, openMode: 'external', username: '', password: '' },
};

export const SENSLINC_POLL_OPTIONS = [
    { value: 1, label: '1 timme' },
    { value: 6, label: '6 timmar' },
    { value: 12, label: '12 timmar' },
    { value: 24, label: '24 timmar (rekommenderat)' },
    { value: 48, label: '48 timmar' },
    { value: 0, label: 'Manuellt (ingen automatisk polling)' },
];
