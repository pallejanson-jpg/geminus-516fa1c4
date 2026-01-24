import React, { useContext, lazy, Suspense } from "react";
import { Loader2, Cuboid, BarChart2, Box, Archive, Radar } from "lucide-react";
import { THEMES } from "@/lib/constants";
import { AppContext } from "@/context/AppContext";
import PortfolioView from "@/components/portfolio/PortfolioView";
import HomeLanding from "@/components/home/HomeLanding";
import PlaceholderView from "@/components/layout/PlaceholderView";
import NavigatorView from "@/components/navigator/NavigatorView";
import Viewer from "@/pages/Viewer";
import InsightsView from "@/components/insights/InsightsView";

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
                return <NavigatorView />;
            case 'assetplus_viewer':
                return <Viewer />;
            case 'viewer':
                // Backwards-compatible key used by Navigator
                return <Viewer />;
            case 'insights':
                return <InsightsView />;
            case 'asset_plus':
                return (
                    <PlaceholderView 
                        title="Asset+" 
                        icon={<Box className="h-8 w-8 text-purple-500" />}
                        description="Asset management"
                    />
                );
            case 'original_archive':
                return (
                    <PlaceholderView 
                        title="OA+" 
                        icon={<Archive className="h-8 w-8 text-indigo-500" />}
                        description="Original archive and documents"
                    />
                );
            case 'radar':
                return (
                    <PlaceholderView 
                        title="360+" 
                        icon={<Radar className="h-8 w-8 text-pink-500" />}
                        description="360-degree viewing"
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
