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
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'swg', label: 'SWG' },
] as const;

export const DEFAULT_APP_CONFIGS: Record<string, any> = {
    insights: { label: 'Insights', url: '', icon: BarChart2, openMode: 'internal', username: '', password: '' },
    fma_plus: { label: 'FMA+', url: 'https://swg-demo.bim.cloud/', icon: Building2, openMode: 'external', username: '', password: '' },
    asset_plus: { label: 'Asset+', url: '', icon: Box, openMode: 'internal', username: '', password: '' },
    iot: { label: 'Sensor Dashboard', url: 'https://swg-demo.bim.cloud/iot', icon: Zap, openMode: 'external', username: '', password: '' },
    original_archive: { label: 'OA+', url: '', icon: Archive, openMode: 'internal', username: '', password: '' },
    radar: { label: '360+', url: '', icon: Radar, openMode: 'internal', username: '', password: '' },
};
