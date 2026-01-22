import React, { useContext, lazy, Suspense } from 'react';
import { Loader2, LayoutGrid, Network, Globe, Cuboid, BarChart2, Box, Archive, Radar, Zap } from 'lucide-react';
import { THEMES, DEFAULT_APP_CONFIGS } from '@/lib/constants';
import { AppContext } from '@/context/AppContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import PortfolioView from '@/components/portfolio/PortfolioView';

// Lazy load MapView to improve initial load time
const MapView = lazy(() => import('@/components/map/MapView'));
// Placeholder view component
const PlaceholderView: React.FC<{ title: string; icon: React.ReactNode; description: string }> = ({ 
    title, 
    icon, 
    description 
}) => {
    const { theme } = useContext(AppContext);
    const t = THEMES[theme];
    
    return (
        <div className="h-full flex items-center justify-center p-8">
            <Card className="max-w-md w-full text-center">
                <CardHeader>
                    <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                        {icon}
                    </div>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Denna vy kommer att migreras från Firebase-projektet.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
};

// Home/Dashboard view
const HomeView: React.FC = () => {
    const { theme } = useContext(AppContext);
    const t = THEMES[theme];
    
    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Välkommen till My SWG</h1>
                <p className={t.textSec}>Din digitala ryggrad för fastighetsdata</p>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[
                    { label: 'Byggnader', value: '24', icon: LayoutGrid },
                    { label: 'Rum', value: '1,247', icon: Box },
                    { label: 'Tillgångar', value: '3,891', icon: Archive },
                    { label: 'Sensorer', value: '156', icon: Zap },
                ].map((stat) => (
                    <Card key={stat.label}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {stat.label}
                            </CardTitle>
                            <stat.icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stat.value}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            
            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Senaste aktivitet</CardTitle>
                        <CardDescription>Aktivitet i dina fastigheter</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {[
                                { action: '3D-modell uppdaterad', building: 'Kontorshus Centrum', time: '2 min sedan' },
                                { action: 'Sensor-larm', building: 'Lagerlokaler Syd', time: '15 min sedan' },
                                { action: 'Dokument uppladdat', building: 'Kv. Björken', time: '1 timme sedan' },
                            ].map((item, i) => (
                                <div key={i} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                                    <div>
                                        <p className="text-sm font-medium">{item.action}</p>
                                        <p className="text-xs text-muted-foreground">{item.building}</p>
                                    </div>
                                    <span className="text-xs text-muted-foreground">{item.time}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Snabbåtgärder</CardTitle>
                        <CardDescription>Vanliga uppgifter</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-3">
                            {Object.entries(DEFAULT_APP_CONFIGS).slice(0, 4).map(([key, cfg]) => {
                                const IconComp = cfg.icon;
                                return (
                                    <button 
                                        key={key}
                                        className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted"
                                    >
                                        <IconComp className="h-5 w-5 text-primary" />
                                        <span className="text-sm font-medium">{cfg.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

const MainContent: React.FC = () => {
    const { theme, activeApp } = useContext(AppContext);
    const t = THEMES[theme];

    const renderContent = () => {
        switch (activeApp) {
            case 'home':
                return <HomeView />;
            case 'portfolio':
                return <PortfolioView />;
            case 'map':
                return (
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    }>
                        <MapView />
                    </Suspense>
                );
            case 'navigation':
                return (
                    <PlaceholderView 
                        title="Navigator" 
                        icon={<Network className="h-8 w-8 text-primary" />}
                        description="Navigera genom byggnadsstruktur och rum"
                    />
                );
            case 'assetplus_viewer':
                return (
                    <PlaceholderView 
                        title="3D Viewer" 
                        icon={<Cuboid className="h-8 w-8 text-primary" />}
                        description="BIM-visare med xeokit för IFC-modeller"
                    />
                );
            case 'insights':
                return (
                    <PlaceholderView 
                        title="Insights" 
                        icon={<BarChart2 className="h-8 w-8 text-green-500" />}
                        description="Analyser och rapporter"
                    />
                );
            case 'asset_plus':
                return (
                    <PlaceholderView 
                        title="Asset+" 
                        icon={<Box className="h-8 w-8 text-purple-500" />}
                        description="Tillgångshantering"
                    />
                );
            case 'original_archive':
                return (
                    <PlaceholderView 
                        title="OA+" 
                        icon={<Archive className="h-8 w-8 text-indigo-500" />}
                        description="Originalarkiv och dokument"
                    />
                );
            case 'radar':
                return (
                    <PlaceholderView 
                        title="360+" 
                        icon={<Radar className="h-8 w-8 text-pink-500" />}
                        description="360-graders visning"
                    />
                );
            default:
                return <HomeView />;
        }
    };

    return (
        <main className={`flex-1 relative overflow-auto ${t.bg}`}>
            <div className="w-full h-full">
                {renderContent()}
            </div>
        </main>
    );
};

export default MainContent;
