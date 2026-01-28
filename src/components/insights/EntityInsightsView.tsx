import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, Zap, TrendingDown, TrendingUp, Leaf, 
    ThermometerSun, Droplets, Gauge, ArrowLeft, Layers, DoorOpen, Package, Box
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Facility } from '@/lib/types';

interface EntityInsightsViewProps {
    facility: Facility;
    onBack: () => void;
}

// Energy distribution (entity-specific mock)
const energyDistribution = [
    { name: 'Heating', value: 42, color: '#ef4444' },
    { name: 'Cooling', value: 22, color: '#3b82f6' },
    { name: 'Lighting', value: 20, color: '#eab308' },
    { name: 'Equipment', value: 12, color: '#8b5cf6' },
    { name: 'Other', value: 4, color: '#6b7280' },
];

// Monthly trend (entity-specific mock)
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

export default function EntityInsightsView({ facility, onBack }: EntityInsightsViewProps) {
    const { allData } = useContext(AppContext);
    
    const isBuilding = facility.category === 'Building';
    const isStorey = facility.category === 'Building Storey';
    const isSpace = facility.category === 'Space';
    const isAsset = facility.category === 'Instance' || (!isBuilding && !isStorey && !isSpace);

    // Calculate actual stats from allData for this entity
    const stats = useMemo(() => {
        let spaces: any[] = [];
        let storeys: any[] = [];
        let assets: any[] = [];

        if (isBuilding) {
            spaces = allData.filter(
                (a: any) => a.category === 'Space' && a.buildingFmGuid === facility.fmGuid
            );
            storeys = allData.filter(
                (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === facility.fmGuid
            );
            assets = allData.filter(
                (a: any) => a.category === 'Instance' && a.buildingFmGuid === facility.fmGuid
            );
        } else if (isStorey) {
            spaces = allData.filter(
                (a: any) => a.category === 'Space' && a.levelFmGuid === facility.fmGuid
            );
            assets = allData.filter(
                (a: any) => a.category === 'Instance' && a.levelFmGuid === facility.fmGuid
            );
        } else if (isSpace) {
            assets = allData.filter(
                (a: any) => a.category === 'Instance' && a.inRoomFmGuid === facility.fmGuid
            );
        }
        
        let totalArea = 0;
        const spacesToCount = isSpace ? [facility] : spaces;
        spacesToCount.forEach((space: any) => {
            const attrs = space.attributes || {};
            const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
            if (ntaKey && attrs[ntaKey]) {
                const val = typeof attrs[ntaKey] === 'object' ? attrs[ntaKey].value : attrs[ntaKey];
                totalArea += Number(val) || 0;
            } else if (attrs.area) {
                totalArea += Number(attrs.area) || 0;
            } else if (space.grossArea) {
                totalArea += Number(space.grossArea) || 0;
            }
        });

        return { 
            floorCount: storeys.length,
            roomCount: spaces.length, 
            assetCount: assets.length,
            totalArea: Math.round(totalArea)
        };
    }, [allData, facility.fmGuid, isBuilding, isStorey, isSpace, facility]);

    // Floor-by-floor/Room-by-room energy data
    const energyBreakdown = useMemo(() => {
        let items: any[] = [];
        
        if (isBuilding) {
            items = allData.filter(
                (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === facility.fmGuid
            );
        } else if (isStorey) {
            items = allData.filter(
                (a: any) => a.category === 'Space' && a.levelFmGuid === facility.fmGuid
            );
        }
        
        return items.slice(0, 8).map((item: any, index: number) => ({
            name: item.commonName || item.name || `Item ${index + 1}`,
            kwhPerSqm: Math.round(60 + Math.random() * 80),
            color: index % 2 === 0 ? '#22c55e' : '#eab308'
        }));
    }, [allData, facility.fmGuid, isBuilding, isStorey]);

    // Get entity type label
    const getEntityLabel = () => {
        if (isBuilding) return 'Building';
        if (isStorey) return 'Floor';
        if (isSpace) return 'Room';
        return 'Asset';
    };

    // Get breakdown label
    const getBreakdownLabel = () => {
        if (isBuilding) return 'per Floor';
        if (isStorey) return 'per Room';
        return '';
    };

    const kpiCards = useMemo(() => {
        const cards: any[] = [];
        
        if (isBuilding) {
            cards.push({ 
                title: 'Floors', 
                value: stats.floorCount, 
                icon: Layers, 
                color: 'text-blue-500'
            });
        }
        
        if (isBuilding || isStorey) {
            cards.push({ 
                title: 'Rooms', 
                value: stats.roomCount, 
                icon: DoorOpen, 
                color: 'text-green-500'
            });
        }
        
        cards.push({ 
            title: 'Assets', 
            value: stats.assetCount, 
            icon: Package, 
            color: 'text-purple-500'
        });
        
        cards.push({ 
            title: 'Area (m²)', 
            value: stats.totalArea.toLocaleString(), 
            icon: Building2, 
            color: 'text-primary'
        });
        
        cards.push({ 
            title: 'Avg. Energy', 
            value: `${Math.round(75 + Math.random() * 40)} kWh/m²`, 
            icon: Zap, 
            trend: '-5%', 
            trendUp: false,
            color: 'text-yellow-500'
        });
        
        cards.push({ 
            title: 'CO₂ (ton/year)', 
            value: Math.round(Math.max(stats.totalArea * 0.015, 0.5)).toLocaleString(), 
            icon: Leaf, 
            trend: '-8%', 
            trendUp: false,
            color: 'text-green-500'
        });
        
        cards.push({ 
            title: 'Energy Rating', 
            value: ['A', 'B', 'C'][Math.floor(Math.random() * 3)], 
            icon: Gauge, 
            color: 'text-primary'
        });
        
        return cards;
    }, [stats, isBuilding, isStorey]);

    return (
        <div className="h-full p-3 sm:p-4 md:p-6 overflow-y-auto">
            {/* Page Header */}
            <div className="mb-6 flex items-start gap-3">
                <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                            {getEntityLabel()}
                        </Badge>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-foreground mt-1">
                        {facility.commonName || facility.name}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Energy efficiency and performance analytics
                    </p>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 sm:gap-4 mb-6">
                {kpiCards.map((kpi, index) => (
                    <Card key={index}>
                        <CardContent className="p-3 sm:p-4">
                            <div className="flex items-center justify-between mb-1">
                                <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color}`} />
                                {kpi.trend && (
                                    <Badge 
                                        variant="secondary" 
                                        className="text-[10px] bg-blue-600"
                                    >
                                        {kpi.trendUp ? <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> : <TrendingDown className="h-2.5 w-2.5 mr-0.5" />}
                                        {kpi.trend}
                                    </Badge>
                                )}
                            </div>
                            <p className="text-lg sm:text-xl font-bold">{kpi.value}</p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Charts Grid */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
                {/* Energy Breakdown Bar Chart - only for Building/Storey */}
                {(isBuilding || isStorey) && energyBreakdown.length > 0 && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Zap className="h-4 w-4 text-yellow-500" />
                                Energy {getBreakdownLabel()}
                            </CardTitle>
                            <CardDescription>kWh per m² breakdown</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={energyBreakdown} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                        <XAxis type="number" className="text-xs" />
                                        <YAxis 
                                            dataKey="name" 
                                            type="category" 
                                            width={100} 
                                            className="text-xs"
                                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                                        />
                                        <Tooltip 
                                            contentStyle={{ 
                                                backgroundColor: 'hsl(var(--popover))',
                                                border: '1px solid hsl(var(--border))',
                                                borderRadius: '8px'
                                            }}
                                            labelStyle={{ color: 'hsl(var(--foreground))' }}
                                        />
                                        <Bar 
                                            dataKey="kwhPerSqm" 
                                            name="kWh/m²"
                                            radius={[0, 4, 4, 0]}
                                        >
                                            {energyBreakdown.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Energy Distribution Pie Chart */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <ThermometerSun className="h-4 w-4 text-orange-500" />
                            Energy Distribution
                        </CardTitle>
                        <CardDescription>Breakdown by category</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={energyDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={45}
                                        outerRadius={75}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        labelLine={false}
                                    >
                                        {energyDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip 
                                        contentStyle={{ 
                                            backgroundColor: 'hsl(var(--popover))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '8px'
                                        }}
                                    />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Monthly Trend - Full Width */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Droplets className="h-4 w-4 text-blue-500" />
                        Monthly Energy Trend
                    </CardTitle>
                    <CardDescription>Actual vs Target consumption (MWh)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={monthlyTrend}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                <XAxis 
                                    dataKey="month" 
                                    className="text-xs"
                                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                                />
                                <YAxis 
                                    className="text-xs"
                                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                                />
                                <Tooltip 
                                    contentStyle={{ 
                                        backgroundColor: 'hsl(var(--popover))',
                                        border: '1px solid hsl(var(--border))',
                                        borderRadius: '8px'
                                    }}
                                />
                                <Legend />
                                <Line 
                                    type="monotone" 
                                    dataKey="consumption" 
                                    name="Actual"
                                    stroke="hsl(var(--primary))" 
                                    strokeWidth={2}
                                    dot={{ fill: 'hsl(var(--primary))' }}
                                />
                                <Line 
                                    type="monotone" 
                                    dataKey="target" 
                                    name="Target"
                                    stroke="#22c55e" 
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    dot={{ fill: '#22c55e' }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
