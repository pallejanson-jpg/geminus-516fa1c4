import React, { useContext, useState, useMemo, useEffect, lazy, Suspense } from "react";
import { Box, Archive, Split } from "lucide-react";
import { AppContext } from "@/context/AppContext";
import { useLanguage } from '@/context/LanguageContext';
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
import GeminusPremiumDashboardView from "@/components/viewer/GeminusPremiumDashboardView";
import NativeViewerPage from "@/pages/NativeViewerPage";

// Lazy load heavy views
const MapView = lazy(() => import("@/components/map/MapView"));
const BlmFormaView = lazy(() => import("@/components/blm-forma/BlmFormaView"));
const GeminusToolsView = lazy(() => import("@/components/geminus-tools/GeminusToolsView"));
const AssetRegistration = lazy(() => import("@/pages/AssetRegistration"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const IvionCreate = lazy(() => import("@/pages/IvionCreate"));
const InAppFaultReport = lazy(() => import("@/components/fault-report/InAppFaultReport"));
const AiAssetScan = lazy(() => import("@/pages/AiAssetScan"));
const FmaInternalView = lazy(() => import("@/components/viewer/FmaInternalView"));
const GeminusBaseNativeView = lazy(() => import("@/components/geminus-base/GeminusBaseNativeView"));
const GeminusBaseV2View = lazy(() => import("@/components/geminus-base/GeminusBaseV2View"));
const CesiumGlobeView = lazy(() => import("@/components/globe/CesiumGlobeView"));
const CustomerPortalView = lazy(() => import("@/components/support/CustomerPortalView"));

const VIEWER_APPS = ['geminus_plus_viewer', 'viewer', 'native_viewer', 'radar', 'geminus_premium_dashboard', 'globe', 'map'];
const FILL_APPS = ['portfolio', 'navigation', 'fma_plus', 'geminus_base_native', 'entity_insights', 'ivion_create', 'ai_scan'];

const LazyFallback = () => {
    const { t } = useLanguage();
    return (
        <div className="flex-1 flex items-center justify-center">
            <Spinner size="lg" label={t('Laddar...', 'Loading...')} />
        </div>
    );
};

const MainContent: React.FC = () => {
    const { activeApp, insightsFacility, setInsightsFacility, setActiveApp, setIvion360Context, setGeminusPremiumDashboardContext, selectedFacility, appConfigs } = useContext(AppContext);
    const isMobile = useIsMobile();
    const { t } = useLanguage();
    const [previousAppBefore360, setPreviousAppBefore360] = useState('portfolio');

    // Route-level document title
    const titleMap: Record<string, string> = {
        home: t('Hem', 'Home'), portfolio: t('Portfolio', 'Portfolio'), map: t('Karta', 'Map'), navigation: t('Navigator', 'Navigator'),
        viewer: t('3D-visare', '3D Viewer'), native_viewer: t('3D-visare', '3D Viewer'), geminus_plus_viewer: t('3D-visare', '3D Viewer'),
        insights: t('Insikter', 'Insights'), entity_insights: t('Byggnadsinsikter', 'Building Insights'), inventory: t('Inventering', 'Inventory'),
        globe: t('Glob', 'Globe'), support: t('Support', 'Support'), fault_report: t('Felrapport', 'Fault Report'),
        ai_scan: t('AI-skanning', 'AI Scan'), radar: t('360°-vy', '360° View'), fma_plus: t('Geminus Base', 'Geminus Base'), geminus_base_native: t('Geminus Base', 'Geminus Base'),
        blm_forma: t('BLM ↔ Forma', 'BLM ↔ Forma'),
        geminus_tools: t('Geminus Tools', 'Geminus Tools'),
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
            case 'geminus_plus_viewer':
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
                const buildingFmGuid = selectedFacility?.fmGuid;
                const buildingName = selectedFacility?.commonName || selectedFacility?.name;
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <FmaInternalView url={fmaUrl} buildingFmGuid={buildingFmGuid} buildingName={buildingName} />
                    </Suspense>
                );
            }
            case 'geminus_base_native':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <GeminusBaseV2View />
                    </Suspense>
                );
            case 'geminus_plus':
                return (
                    <PlaceholderView 
                        title="Geminus Plus" 
                        icon={<Box className="h-8 w-8 text-purple-500" />}
                        description={t('Tillgångshantering', 'Asset management')}
                    />
                );
            case 'original_archive':
                return (
                    <PlaceholderView 
                        title="OA+" 
                        icon={<Archive className="h-8 w-8 text-indigo-500" />}
                        description={t('Originalarkiv och dokument', 'Original archive and documents')}
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
            case 'geminus_premium_dashboard':
                return (
                    <GeminusPremiumDashboardView 
                        onClose={() => {
                            setGeminusPremiumDashboardContext(null);
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
                        <AiAssetScan preselectedBuildingGuid={selectedFacility?.fmGuid} />
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
            case 'blm_forma':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <BlmFormaView />
                    </Suspense>
                );
            case 'geminus_tools':
                return (
                    <Suspense fallback={<LazyFallback />}>
                        <GeminusToolsView />
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
            className={`absolute inset-0 ${isViewerApp ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'} bg-background`}
            style={isMobileViewer ? { touchAction: 'none' } : undefined}
        >
            <div className={needsHFull ? "w-full h-full" : "w-full"}>
                {renderContent()}
            </div>
        </main>
    );
};

export default MainContent;
