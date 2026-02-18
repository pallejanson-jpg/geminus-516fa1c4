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
import SensorsTab from './tabs/SensorsTab';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
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
    sensors: 'co2',
};

export default function InsightsView({ selectedBuilding }: InsightsViewProps) {
    const { setActiveApp, setSelectedFacility, navigatorTreeData } = useContext(AppContext);
    const [viewingBuilding, setViewingBuilding] = useState<Facility | null>(selectedBuilding || null);
    const [activeTab, setActiveTab] = useState('performance');

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

    const mapColoringMode = TAB_COLORING_MAP[activeTab] ?? 'none';

    return (
        <div className="p-2 sm:p-3 md:p-4 lg:p-6">
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
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <div className="overflow-x-auto -mx-2 px-2 pb-1 mb-4 sm:mb-6">
                        <TabsList className="inline-flex w-max min-w-full sm:w-full sm:min-w-0 h-auto p-0.5 sm:p-1 gap-0.5 sm:gap-1">
                                <TabsTrigger value="performance" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Performance
                                </TabsTrigger>
                                <TabsTrigger value="facility" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    FM
                                </TabsTrigger>
                                <TabsTrigger value="space" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Space
                                </TabsTrigger>
                                <TabsTrigger value="asset" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Asset
                                </TabsTrigger>
                                <TabsTrigger value="portfolio" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Portfolio
                                </TabsTrigger>
                                <TabsTrigger value="sensors" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2 gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
                                    Sensors
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="performance" className="mt-0">
                            <PerformanceTab onSelectBuilding={setViewingBuilding} />
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
                            <PortfolioManagementTab />
                        </TabsContent>

                        <TabsContent value="sensors" className="mt-0">
                            <SensorsTab />
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Right: Mini-map with coloring synced to active tab */}
                <div className="hidden xl:block xl:w-[380px] 2xl:w-[440px] shrink-0">
                    <div className="sticky top-4">
                        <div className="rounded-xl overflow-hidden border border-border shadow-md" style={{ height: '520px' }}>
                            <Suspense fallback={
                                <div className="flex items-center justify-center h-full bg-muted/20">
                                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                </div>
                            }>
                                <MapView initialColoringMode={mapColoringMode} />
                            </Suspense>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                            Markeringar färgas efter aktiv tab ({activeTab})
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

