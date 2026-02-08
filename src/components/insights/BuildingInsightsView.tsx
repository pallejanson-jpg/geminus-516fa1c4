import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, Zap, TrendingDown, TrendingUp, Leaf, 
    ThermometerSun, Droplets, Gauge, ArrowLeft, Layers, DoorOpen, Package
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Facility } from '@/lib/types';
import { useIsMobile } from '@/hooks/use-mobile';

interface BuildingInsightsViewProps {
    facility: Facility;
    onBack: () => void;
}

// Mockup indicator badge
const MockBadge = () => (
    <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30 ml-1">
        Demo
    </Badge>
);

// Energy distribution (building-specific mock)
const energyDistribution = [
    { name: 'Heating', value: 42, color: 'hsl(var(--destructive))' },
    { name: 'Cooling', value: 22, color: 'hsl(220, 80%, 55%)' },
    { name: 'Lighting', value: 20, color: 'hsl(48, 96%, 53%)' },
    { name: 'Equipment', value: 12, color: 'hsl(262, 83%, 58%)' },
    { name: 'Other', value: 4, color: 'hsl(var(--muted-foreground))' },
];

// Monthly trend (building-specific mock)
const monthlyTrend = [
    { month: 'Jan', consumption: 48, target: 42 },
    { month: 'Feb', consumption: 45, target: 41 },
    { month: 'Mar', consumption: 40, target: 40 },
    { month: 'Apr', consumption: 32, target: 37 },
    { month: 'May', consumption: 28, target: 33 },
    { month: 'Jun', consumption: 24, target: 30 },
    { month: 'Jul', consumption: 26, target: 29 },
    { month: 'Aug', consumption: 27, target: 30 },
    { month: 'Sep', consumption: 31, target: 33 },
    { month: 'Oct', consumption: 36, target: 37 },
    { month: 'Nov', consumption: 43, target: 40 },
    { month: 'Dec', consumption: 47, target: 43 },
];

const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

export default function BuildingInsightsView({ facility, onBack }: BuildingInsightsViewProps) {
    const { allData } = useContext(AppContext);
    const isMobile = useIsMobile();

    // Calculate actual stats from allData for this building (REAL)
    const stats = useMemo(() => {
        const spaces = allData.filter(
            (a: any) => (a.category === 'Space' || a.category === 'IfcSpace') && a.buildingFmGuid === facility.fmGuid
        );
        const storeys = allData.filter(
            (a: any) => (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey') && a.buildingFmGuid === facility.fmGuid
        );
        const assets = allData.filter(
            (a: any) => a.category !== 'Building' && a.category !== 'Building Storey' && a.category !== 'Space' &&
                         a.category !== 'IfcBuilding' && a.category !== 'IfcBuildingStorey' && a.category !== 'IfcSpace' &&
                         a.buildingFmGuid === facility.fmGuid
        );
        
        let totalArea = 0;
        spaces.forEach((space: any) => {
            const attrs = space.attributes || {};
            const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
            if (ntaKey && attrs[ntaKey]) {
                totalArea += Number(attrs[ntaKey]) || 0;
            } else if (attrs.area) {
                totalArea += Number(attrs.area) || 0;
            } else if (space.grossArea) {
                totalArea += Number(space.grossArea) || 0;
            }
        });

        // Asset category distribution (REAL)
        const assetCategories: Record<string, number> = {};
        assets.forEach((asset: any) => {
            const cat = (asset.assetType || asset.category || 'Unknown').replace('Ifc', '');
            assetCategories[cat] = (assetCategories[cat] || 0) + 1;
        });

        // Space types (REAL)
        const spaceTypes: Record<string, number> = {};
        spaces.forEach((space: any) => {
            const attrs = space.attributes || {};
            const type = attrs.spaceType || attrs.roomType || 'Unknown';
            spaceTypes[type] = (spaceTypes[type] || 0) + 1;
        });

        return { 
            floorCount: storeys.length,
            roomCount: spaces.length, 
            assetCount: assets.length,
            totalArea: Math.round(totalArea),
            assetCategories,
            spaceTypes,
        };
    }, [allData, facility.fmGuid]);

    // Floor-by-floor energy data (MOCK)
    const energyByFloor = useMemo(() => {
        const storeys = allData.filter(
            (a: any) => (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey') && a.buildingFmGuid === facility.fmGuid
        );
        return storeys.slice(0, 6).map((storey: any, index: number) => {
            const hash = hashString(storey.fmGuid || '');
            return {
                name: storey.commonName || storey.name || `Floor ${index + 1}`,
                kwhPerSqm: 80 + (hash % 60),
                color: index % 2 === 0 ? 'hsl(142, 71%, 45%)' : 'hsl(48, 96%, 53%)',
            };
        });
    }, [allData, facility.fmGuid]);

    const renderPieLabel = isMobile 
        ? undefined 
        : ({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`;

    // Prepare asset category pie data (REAL)
    const assetCategoryPie = useMemo(() => {
        const colors = [
            'hsl(220, 80%, 55%)', 'hsl(48, 96%, 53%)', 'hsl(var(--primary))',
            'hsl(var(--destructive))', 'hsl(142, 71%, 45%)', 'hsl(262, 83%, 58%)',
        ];
        return Object.entries(stats.assetCategories)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, value], i) => ({ name, value, color: colors[i % colors.length] }));
    }, [stats.assetCategories]);

    // Prepare space type pie data (REAL)
    const spaceTypePie = useMemo(() => {
        const colors = [
            'hsl(var(--primary))', 'hsl(220, 80%, 55%)', 'hsl(142, 71%, 45%)',
            'hsl(48, 96%, 53%)', 'hsl(262, 83%, 58%)', 'hsl(var(--muted-foreground))',
        ];
        return Object.entries(stats.spaceTypes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, value], i) => ({ name: name.length > 15 ? name.substring(0, 15) + '...' : name, value, color: colors[i % colors.length] }));
    }, [stats.spaceTypes]);

    return (
        <div className="h-full p-2 sm:p-3 md:p-4 lg:p-6 overflow-y-auto">
            {/* Page Header */}
            <div className="mb-4 sm:mb-6 flex items-start gap-3">
                <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5 shrink-0">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground">
                        {facility.commonName || facility.name}
                    </h1>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                        Building insights and analytics
                    </p>
                </div>
            </div>

            {/* KPI Cards - REAL counts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-4 sm:mb-6">
                {[
                    { title: 'Floors', value: stats.floorCount, icon: Layers, color: 'text-blue-500', isMock: false },
                    { title: 'Rooms', value: stats.roomCount, icon: DoorOpen, color: 'text-green-500', isMock: false },
                    { title: 'Assets', value: stats.assetCount, icon: Package, color: 'text-purple-500', isMock: false },
                    { title: 'Area (m²)', value: stats.totalArea.toLocaleString(), icon: Building2, color: 'text-primary', isMock: false },
                    { title: 'Avg. Energy', value: `${80 + (hashString(facility.fmGuid || '') % 40)} kWh/m²`, icon: Zap, color: 'text-yellow-500', isMock: true },
                    { title: 'Energy Rating', value: ['A', 'B', 'C'][hashString(facility.fmGuid || '') % 3], icon: Gauge, color: 'text-primary', isMock: true },
                ].map((kpi, index) => (
                    <Card key={index}>
                        <CardContent className="p-3 sm:p-4">
                            <div className="flex items-center justify-between mb-1">
                                <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color}`} />
                                {kpi.isMock && <MockBadge />}
                            </div>
                            <p className={`text-lg sm:text-xl font-bold ${kpi.isMock ? 'text-purple-400' : 'text-foreground'}`}>
                                {kpi.value}
                            </p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Tabs: Performance, Space, Asset */}
            <Tabs defaultValue="performance" className="w-full">
                <div className="overflow-x-auto -mx-2 px-2 pb-1 mb-4 sm:mb-6">
                    <TabsList className="inline-flex w-max min-w-full sm:w-full sm:min-w-0 h-auto p-0.5 sm:p-1 gap-0.5 sm:gap-1">
                        <TabsTrigger value="performance" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                            Performance
                        </TabsTrigger>
                        <TabsTrigger value="space" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                            Space
                        </TabsTrigger>
                        <TabsTrigger value="asset" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                            Asset
                        </TabsTrigger>
                    </TabsList>
                </div>

                {/* Performance Tab - mostly MOCK energy data */}
                <TabsContent value="performance" className="mt-0 space-y-6">
                    <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                        {/* Energy per Floor - MOCK */}
                        {energyByFloor.length > 0 && (
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Zap className="h-4 w-4 text-yellow-500" />
                                        <span className="text-purple-400">Energy per Floor</span>
                                        <MockBadge />
                                    </CardTitle>
                                    <CardDescription>kWh per m² by floor level</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={energyByFloor} layout="vertical">
                                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                                <XAxis type="number" className="text-xs" />
                                                <YAxis 
                                                    dataKey="name" type="category" 
                                                    width={isMobile ? 60 : 80}
                                                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }}
                                                />
                                                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                                                <Bar dataKey="kwhPerSqm" name="kWh/m²" radius={[0, 4, 4, 0]}>
                                                    {energyByFloor.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Energy Distribution - MOCK */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <ThermometerSun className="h-4 w-4 text-orange-500" />
                                    <span className="text-purple-400">Energy Distribution</span>
                                    <MockBadge />
                                </CardTitle>
                                <CardDescription>Breakdown by category</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={energyDistribution} cx="50%" cy="50%" innerRadius={isMobile ? 40 : 45} outerRadius={isMobile ? 65 : 75} paddingAngle={2} dataKey="value" label={renderPieLabel} labelLine={!isMobile}>
                                                {energyDistribution.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                                            <Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Monthly Trend - MOCK */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Droplets className="h-4 w-4 text-blue-500" />
                                <span className="text-purple-400">Monthly Energy Trend</span>
                                <MockBadge />
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={monthlyTrend}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                                        <Legend />
                                        <Line type="monotone" dataKey="consumption" name="Actual" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))' }} />
                                        <Line type="monotone" dataKey="target" name="Target" stroke="hsl(142, 71%, 45%)" strokeWidth={2} strokeDasharray="5 5" dot={{ fill: 'hsl(142, 71%, 45%)' }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Space Tab - REAL room data */}
                <TabsContent value="space" className="mt-0 space-y-6">
                    <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                        {/* Room Types Distribution - REAL */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <DoorOpen className="h-4 w-4 text-green-500" />
                                    Room Types
                                </CardTitle>
                                <CardDescription>{stats.roomCount} rooms · {stats.totalArea.toLocaleString()} m² (real data)</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="h-64">
                                    {spaceTypePie.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={spaceTypePie} cx="50%" cy="50%" innerRadius={isMobile ? 40 : 50} outerRadius={isMobile ? 65 : 80} paddingAngle={2} dataKey="value" label={renderPieLabel} labelLine={!isMobile}>
                                                    {spaceTypePie.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-muted-foreground">No room data</div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Asset Tab - REAL asset data */}
                <TabsContent value="asset" className="mt-0 space-y-6">
                    <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                        {/* Asset Category Distribution - REAL */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Package className="h-4 w-4 text-primary" />
                                    Asset Categories
                                </CardTitle>
                                <CardDescription>{stats.assetCount} assets (real data)</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="h-64">
                                    {assetCategoryPie.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={assetCategoryPie} cx="50%" cy="50%" innerRadius={isMobile ? 40 : 50} outerRadius={isMobile ? 65 : 80} paddingAngle={2} dataKey="value" label={renderPieLabel} labelLine={!isMobile}>
                                                    {assetCategoryPie.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-muted-foreground">No asset data</div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
