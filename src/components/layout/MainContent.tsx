import React, { useContext, useState, useMemo, useEffect, lazy, Suspense } from "react";
import { Box, Archive, Split } from "lucide-react";
import { THEMES } from "@/lib/constants";
import { AppContext } from "@/context/AppContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import PortfolioView from "@/components/portfolio/PortfolioView";
import HomeLanding from "@/components/home/HomeLanding";
import PlaceholderView from "@/components/layout/PlaceholderView";
import NavigatorView from "@/components/navigator/NavigatorView";
import InsightsView from "@/components/insights/InsightsView";
import BuildingInsightsView from "@/components/insights/BuildingInsightsView";
import Ivion360View from "@/components/viewer/Ivion360View";
import SenslincDashboardView from "@/components/viewer/SenslincDashboardView";
import NativeViewerPage from "@/pages/NativeViewerPage";

// Lazy load heavy views
const MapView = lazy(() => import("@/components/map/MapView"));
const AssetRegistration = lazy(() => import("@/pages/AssetRegistration"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const IvionCreate = lazy(() => import("@/pages/IvionCreate"));
const InAppFaultReport = lazy(() => import("@/components/fault-report/InAppFaultReport"));
const AiAssetScan = lazy(() => import("@/pages/AiAssetScan"));
const FmaInternalView = lazy(() => import("@/components/viewer/FmaInternalView"));
const FmAccessNativeView = lazy(() => import("@/components/fm-access/FmAccessNativeView"));
const CesiumGlobeView = lazy(() => import("@/components/globe/CesiumGlobeView"));
const CustomerPortalView = lazy(() => import("@/components/support/CustomerPortalView"));

const VIEWER_APPS = ['assetplus_viewer', 'viewer', 'native_viewer', 'radar', 'senslinc_dashboard', 'globe', 'map'];
const FILL_APPS = ['portfolio', 'navigation', 'fma_plus', 'fma_native', 'entity_insights', 'ivion_create'];

const LazyFallback = () => (
    <div className="flex-1 flex items-center justify-center">
        <Spinner size="lg" label="Loading..." />
    </div>
);

const MainContent: React.FC = () => {
    const { theme, activeApp, insightsFacility, setInsightsFacility, setActiveApp, setIvion360Context, setSenslincDashboardContext, selectedFacility, appConfigs } = useContext(AppContext);
    const isMobile = useIsMobile();
    const t = THEMES[theme];
    const [previousAppBefore360, setPreviousAppBefore360] = useState('portfolio');

    // Route-level document title
    const titleMap: Record<string, string> = {
        home: 'Home', portfolio: 'Portfolio', map: 'Map', navigation: 'Navigator',
        viewer: '3D Viewer', native_viewer: '3D Viewer', assetplus_viewer: '3D Viewer',
        insights: 'Insights', entity_insights: 'Building Insights', inventory: 'Inventory',
        globe: 'Globe', support: 'Support', fault_report: 'Fault Report',
        ai_scan: 'AI Scan', radar: '360° View', fma_plus: 'FM Access', fma_native: 'FM Access',
    };
    useDocumentTitle(titleMap[activeApp] || null);

    useEffect(() => {
        import('@/components/globe/CesiumGlobeView').catch(() => {});
    }, []);

    const renderContent = () => {
        switch (activeApp) {
            case 'home':
                return <HomeLanding />;
            case 'portfolio':
                return <PortfolioView />;
            case 'map':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <MapView />
                    </Suspense>
                );
            case 'navigation':
                return <NavigatorView />;
            case 'assetplus_viewer':
            case 'viewer':
            case 'native_viewer':
                return <NativeViewerPage />;
            case 'asset_registration':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <AssetRegistration />
                    </Suspense>
                );
            case 'insights':
                return <InsightsView />;
            case 'entity_insights':
                if (insightsFacility) {
                    return (
                        <BuildingInsightsView 
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
                const fmaUrl = appConfigs?.fma_plus?.url || 'https://swg-demo.bim.cloud/';
                const buildingFmGuid = selectedFacility?.fm_guid || selectedFacility?.fmGuid;
                const buildingName = selectedFacility?.commonName || selectedFacility?.name;
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <FmaInternalView url={fmaUrl} buildingFmGuid={buildingFmGuid} buildingName={buildingName} />
                    </Suspense>
                );
            }
            case 'fma_native':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <FmAccessNativeView />
                    </Suspense>
                );
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
                    <Suspense fallback={<LazyFallback />}>
                        <Inventory />
                    </Suspense>
                );
            case 'ivion_create':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <IvionCreate />
                    </Suspense>
                );
            case 'fault_report':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <InAppFaultReport />
                    </Suspense>
                );
            case 'ai_scan':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <AiAssetScan preselectedBuildingGuid={selectedFacility?.fm_guid} />
                    </Suspense>
                );
            case 'globe':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <CesiumGlobeView />
                    </Suspense>
                );
            case 'support':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <CustomerPortalView />
                    </Suspense>
                );
            default:
                return <HomeLanding />;
        }
    };

    const isViewerApp = VIEWER_APPS.includes(activeApp);
    const needsHFull = isViewerApp || FILL_APPS.includes(activeApp);
    const isMobileViewer = isMobile && (isViewerApp || FILL_APPS.includes(activeApp));

    return (
        <main 
            className={`absolute inset-0 ${isViewerApp ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'} ${t.bg}`}
            style={isMobileViewer ? { touchAction: 'none' } : undefined}
        >
            <div className={needsHFull ? "w-full h-full" : "w-full"}>
                {renderContent()}
            </div>
        </main>
    );
};

export default MainContent;
