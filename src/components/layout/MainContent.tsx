import React, { useContext, useState, lazy, Suspense } from "react";
import { Loader2, Box, Archive, Split } from "lucide-react";
import { THEMES } from "@/lib/constants";
import { AppContext } from "@/context/AppContext";
import { useIsMobile } from "@/hooks/use-mobile";
import PortfolioView from "@/components/portfolio/PortfolioView";
import HomeLanding from "@/components/home/HomeLanding";
import PlaceholderView from "@/components/layout/PlaceholderView";
import NavigatorView from "@/components/navigator/NavigatorView";
import Viewer from "@/pages/Viewer";
import InsightsView from "@/components/insights/InsightsView";
import EntityInsightsView from "@/components/insights/EntityInsightsView";
import Ivion360View from "@/components/viewer/Ivion360View";
import SenslincDashboardView from "@/components/viewer/SenslincDashboardView";

// Lazy load heavy views
const MapView = lazy(() => import("@/components/map/MapView"));
const AssetRegistration = lazy(() => import("@/pages/AssetRegistration"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const IvionCreate = lazy(() => import("@/pages/IvionCreate"));
const InAppFaultReport = lazy(() => import("@/components/fault-report/InAppFaultReport"));
const AiAssetScan = lazy(() => import("@/pages/AiAssetScan"));
const FmaInternalView = lazy(() => import("@/components/viewer/FmaInternalView"));

const IMMERSIVE_VIEWER_APPS = ['assetplus_viewer', 'viewer', 'radar', 'map', 'fma_plus'];

const MainContent: React.FC = () => {
    const { theme, activeApp, insightsFacility, setInsightsFacility, setActiveApp, setIvion360Context, setSenslincDashboardContext, selectedFacility, appConfigs } = useContext(AppContext);
    const isMobile = useIsMobile();
    const t = THEMES[theme];
    const [previousAppBefore360, setPreviousAppBefore360] = useState('portfolio');

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
            case 'asset_registration':
                return (
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    }>
                        <AssetRegistration />
                    </Suspense>
                );
            case 'insights':
                return <InsightsView />;
            case 'entity_insights':
                if (insightsFacility) {
                    return (
                        <EntityInsightsView 
                            facility={insightsFacility} 
                            onBack={() => {
                                setInsightsFacility(null);
                                setActiveApp('portfolio');
                            }} 
                        />
                    );
                }
                return <InsightsView />;
            case 'fma_plus': {
                const fmaConfig = appConfigs?.fma_plus || {};
                return (
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    }>
                        <FmaInternalView
                            url={fmaConfig.url || 'https://swg-demo.bim.cloud/'}
                            buildingFmGuid={selectedFacility?.fm_guid}
                            buildingName={selectedFacility?.name}
                        />
                    </Suspense>
                );
            }
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
                    <Ivion360View 
                        onClose={() => {
                            setIvion360Context(null);
                            setActiveApp(previousAppBefore360 || 'portfolio');
                        }} 
                    />
                );
            case 'senslinc_dashboard':
                return (
                    <SenslincDashboardView 
                        onClose={() => {
                            setSenslincDashboardContext(null);
                            setActiveApp('portfolio');
                        }} 
                    />
                );
            case 'inventory':
                return (
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    }>
                        <Inventory />
                    </Suspense>
                );
            case 'ivion_create':
                return (
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    }>
                        <IvionCreate />
                    </Suspense>
                );
            case 'fault_report':
                return (
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    }>
                        <InAppFaultReport />
                    </Suspense>
                );
            case 'ai_scan':
                return (
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    }>
                        <AiAssetScan preselectedBuildingGuid={selectedFacility?.fm_guid} />
                    </Suspense>
                );
            default:
                return <HomeLanding />;
        }
    };

    // On mobile, immersive viewer apps need overflow-hidden and touch-action: none
    // to prevent the parent container from intercepting touch events meant for the 3D canvas
    const isImmersiveViewer = isMobile && IMMERSIVE_VIEWER_APPS.includes(activeApp);

    return (
        <main 
            className={`flex-1 relative ${isImmersiveViewer ? 'overflow-hidden' : 'overflow-auto'} ${t.bg}`}
            style={isImmersiveViewer ? { touchAction: 'none' } : undefined}
        >
            <div className="w-full h-full">
                {renderContent()}
            </div>
        </main>
    );
};

export default MainContent;
