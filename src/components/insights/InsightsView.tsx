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
    const [viewingBuilding, setViewingBuilding] = useState<Facility | null>(selectedBuilding || null);

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
        <div className="h-full p-3 sm:p-4 md:p-6 overflow-y-auto">
            {/* Page Header */}
            <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Insights</h1>
                <p className="text-sm text-muted-foreground">
                    Analys och insikter för din fastighetsportfölj
                </p>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="performance" className="w-full">
                <TabsList className="w-full flex-nowrap overflow-x-auto justify-start mb-6 h-auto p-1">
                    <TabsTrigger value="performance" className="text-xs sm:text-sm whitespace-nowrap">
                        Performance
                    </TabsTrigger>
                    <TabsTrigger value="facility" className="text-xs sm:text-sm whitespace-nowrap">
                        Facility Management
                    </TabsTrigger>
                    <TabsTrigger value="space" className="text-xs sm:text-sm whitespace-nowrap">
                        Space Management
                    </TabsTrigger>
                    <TabsTrigger value="asset" className="text-xs sm:text-sm whitespace-nowrap">
                        Asset Management
                    </TabsTrigger>
                    <TabsTrigger value="portfolio" className="text-xs sm:text-sm whitespace-nowrap">
                        Portfolio Management
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="performance" className="mt-0">
                    <PerformanceTab onSelectBuilding={setViewingBuilding} />
                </TabsContent>

                <TabsContent value="facility" className="mt-0">
                    <FacilityManagementTab />
                </TabsContent>

                <TabsContent value="space" className="mt-0">
                    <SpaceManagementTab />
                </TabsContent>

                <TabsContent value="asset" className="mt-0">
                    <AssetManagementTab />
                </TabsContent>

                <TabsContent value="portfolio" className="mt-0">
                    <PortfolioManagementTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}
