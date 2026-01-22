import React, { useContext, lazy, Suspense } from "react";
import { Loader2, Network, Cuboid, BarChart2, Box, Archive, Radar } from "lucide-react";
import { THEMES } from "@/lib/constants";
import { AppContext } from "@/context/AppContext";
import PortfolioView from "@/components/portfolio/PortfolioView";
import HomeLanding from "@/components/home/HomeLanding";
import PlaceholderView from "@/components/layout/PlaceholderView";

// Lazy load MapView to improve initial load time
const MapView = lazy(() => import("@/components/map/MapView"));

const MainContent: React.FC = () => {
    const { theme, activeApp } = useContext(AppContext);
    const t = THEMES[theme];

    const renderContent = () => {
        switch (activeApp) {
            case 'home':
                return <HomeLanding />;
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
                return <HomeLanding />;
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
