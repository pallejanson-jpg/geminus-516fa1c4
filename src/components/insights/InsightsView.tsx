import React, { useContext, useState, lazy, Suspense } from 'react';
import { AppContext } from '@/context/AppContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Facility } from '@/lib/types';
import BuildingInsightsView from './BuildingInsightsView';
import PerformanceTab from './tabs/PerformanceTab';
import FacilityManagementTab from './tabs/FacilityManagementTab';
import SpaceManagementTab from './tabs/SpaceManagementTab';
import AssetManagementTab from './tabs/AssetManagementTab';
import PortfolioManagementTab from './tabs/PortfolioManagementTab';
import PredictiveMaintenanceTab from './tabs/PredictiveMaintenanceTab';
import RoomOptimizationTab from './tabs/RoomOptimizationTab';
import RagSearchTab from './tabs/RagSearchTab';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Expand, Shrink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MapColoringMode } from '@/lib/map-coloring-utils';

const MapView = lazy(() => import('@/components/map/MapView'));

interface InsightsViewProps {
    selectedBuilding?: Facility | null;
}

// Map tab → coloring mode
const TAB_COLORING_MAP: Record<string, MapColoringMode> = {
    performance: 'energy-efficiency',
    facility: 'work-orders',
    space: 'co2',
    asset: 'work-orders',
    portfolio: 'none',
    predictive: 'none',
    optimization: 'none',
    search: 'none',
};

export default function InsightsView({ selectedBuilding }: InsightsViewProps) {
    const { setActiveApp, setSelectedFacility, navigatorTreeData } = useContext(AppContext);
    const [viewingBuilding, setViewingBuilding] = useState<Facility | null>(selectedBuilding || null);
    const [activeTab, setActiveTab] = useState('performance');
    // External coloring override — set when user clicks "Visa" in a chart
    const [chartColoringMode, setChartColoringMode] = useState<MapColoringMode | undefined>(undefined);

    // Navigation callbacks for clickable real values
    const handleNavigateToAssets = (buildingFmGuid?: string) => {
        if (buildingFmGuid) {
            const building = navigatorTreeData.find(b => b.fmGuid === buildingFmGuid);
            if (building) {
                setSelectedFacility(building);
            }
        }
        setActiveApp('portfolio');
    };

    const handleNavigateToRooms = (buildingFmGuid?: string) => {
        if (buildingFmGuid) {
            const building = navigatorTreeData.find(b => b.fmGuid === buildingFmGuid);
            if (building) {
                setSelectedFacility(building);
            }
        }
        setActiveApp('portfolio');
    };

    // If viewing a specific building, show the building insights view
    if (viewingBuilding) {
        return (
            <BuildingInsightsView 
                facility={viewingBuilding} 
                onBack={() => setViewingBuilding(null)} 
            />
        );
    }

    // Effective coloring: chart override > tab default
    const mapColoringMode: MapColoringMode = chartColoringMode ?? (TAB_COLORING_MAP[activeTab] ?? 'none');

    // When switching tabs, clear chart coloring override
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        setChartColoringMode(undefined);
    };

    return (
        <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4">
            {/* Page Header with back button */}
            <div className="mb-4 sm:mb-6 flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setActiveApp('portfolio')}
                    className="h-8 w-8 shrink-0"
                    title="Tillbaka till Portfolio"
                >
                    <ArrowLeft size={18} />
                </Button>
                <div>
                    <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground">Insights</h1>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                        Analytics and insights for your property portfolio
                    </p>
                </div>
            </div>

            {/* Main layout: tabs left, mini-map right */}
            <div className="flex flex-col xl:flex-row gap-4 xl:gap-6">
                {/* Left: Tabs + Charts */}
                <div className="flex-1 min-w-0">
                    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                        <div className="overflow-x-auto -mx-2 px-2 pb-1 mb-4 sm:mb-6">
                        <TabsList className="inline-flex w-max min-w-full sm:w-full sm:min-w-0 h-auto p-0.5 sm:p-1 gap-0.5 sm:gap-1">
                                <TabsTrigger value="performance" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Performance
                                </TabsTrigger>
                                <TabsTrigger value="facility" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    FM
                                </TabsTrigger>
                                <TabsTrigger value="space" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Space
                                </TabsTrigger>
                                <TabsTrigger value="asset" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Asset
                                </TabsTrigger>
                                <TabsTrigger value="portfolio" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Portfolio
                                </TabsTrigger>
                                <TabsTrigger value="predictive" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    🔮 Predictive
                                </TabsTrigger>
                                <TabsTrigger value="optimization" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    📐 Optimization
                                </TabsTrigger>
                                <TabsTrigger value="search" className="text-[11px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    🔍 RAG Search
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="performance" className="mt-0">
                            <PerformanceTab onSelectBuilding={setViewingBuilding} onColorMap={setChartColoringMode} />
                        </TabsContent>

                        <TabsContent value="facility" className="mt-0">
                            <FacilityManagementTab />
                        </TabsContent>

                        <TabsContent value="space" className="mt-0">
                            <SpaceManagementTab onNavigateToRooms={handleNavigateToRooms} />
                        </TabsContent>

                        <TabsContent value="asset" className="mt-0">
                            <AssetManagementTab onNavigateToAssets={handleNavigateToAssets} />
                        </TabsContent>

                        <TabsContent value="portfolio" className="mt-0">
                            <PortfolioManagementTab onColorMap={setChartColoringMode} />
                        </TabsContent>

                        <TabsContent value="predictive" className="mt-0">
                            <PredictiveMaintenanceTab />
                        </TabsContent>

                        <TabsContent value="optimization" className="mt-0">
                            <RoomOptimizationTab />
                        </TabsContent>

                        <TabsContent value="search" className="mt-0">
                            <RagSearchTab />
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Right: Mini-map with coloring synced to active tab */}
                <InsightsMap mapColoringMode={mapColoringMode} activeTab={activeTab} />
            </div>
        </div>
    );
}

/** Insights map panel — supports inline (small), enlarged, and fullscreen modes */
function InsightsMap({ mapColoringMode, activeTab }: { mapColoringMode: MapColoringMode; activeTab: string }) {
    const [enlarged, setEnlarged] = useState(false);

    return (
        <div className={cn(
            "shrink-0 transition-all duration-300",
            enlarged 
                ? "fixed inset-4 z-50 flex items-center justify-center" 
                : "hidden xl:block xl:w-[380px] 2xl:w-[440px]"
        )}>
            {enlarged && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setEnlarged(false)} />
            )}
            <div className={cn(
                "relative",
                enlarged ? "w-full max-w-4xl h-[80vh] z-10" : "sticky top-4"
            )}>
                <div className={cn(
                    "rounded-xl overflow-hidden border border-border shadow-md",
                    enlarged ? "h-full" : ""
                )} style={enlarged ? undefined : { height: '520px' }}>
                    <Suspense fallback={
                        <div className="flex items-center justify-center h-full bg-muted/20">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    }>
                        <MapView
                            initialColoringMode={mapColoringMode}
                            hideSidebar
                            compact={!enlarged}
                            externalColoringMode={mapColoringMode}
                        />
                    </Suspense>
                </div>
                {/* Enlarge/shrink button */}
                <div className="absolute top-2 right-2 z-20">
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-8 w-8 bg-card/90 backdrop-blur-sm shadow-lg"
                        onClick={() => setEnlarged(prev => !prev)}
                        title={enlarged ? "Shrink map" : "Enlarge map"}
                    >
                        {enlarged ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
                    </Button>
                </div>
                {!enlarged && (
                    <p className="text-[11px] sm:text-xs text-muted-foreground mt-1.5 text-center">
                        Markers colored by active tab ({activeTab})
                    </p>
                )}
            </div>
        </div>
    );
}
