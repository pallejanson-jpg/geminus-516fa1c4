import React, { useContext, useState } from 'react';
import { AppContext } from '@/context/AppContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Facility } from '@/lib/types';
import BuildingInsightsView from './BuildingInsightsView';
import PerformanceTab from './tabs/PerformanceTab';
import FacilityManagementTab from './tabs/FacilityManagementTab';
import SpaceManagementTab from './tabs/SpaceManagementTab';
import AssetManagementTab from './tabs/AssetManagementTab';
import PortfolioManagementTab from './tabs/PortfolioManagementTab';

interface InsightsViewProps {
    selectedBuilding?: Facility | null;
}

export default function InsightsView({ selectedBuilding }: InsightsViewProps) {
    const { setActiveApp, setSelectedFacility, navigatorTreeData } = useContext(AppContext);
    const [viewingBuilding, setViewingBuilding] = useState<Facility | null>(selectedBuilding || null);

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

    return (
        <div className="h-full p-2 sm:p-3 md:p-4 lg:p-6 overflow-y-auto">
            {/* Page Header */}
            <div className="mb-4 sm:mb-6">
                <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground">Insights</h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                    Analytics and insights for your property portfolio
                </p>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="performance" className="w-full">
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
            </Tabs>
        </div>
    );
}
