import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, Zap, TrendingDown, TrendingUp, Leaf, 
    ThermometerSun, Droplets, Gauge, ArrowLeft, Layers, DoorOpen
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Facility } from '@/lib/types';

interface BuildingInsightsViewProps {
    facility: Facility;
    onBack: () => void;
}

// Energy distribution (building-specific mock)
const energyDistribution = [
    { name: 'Heating', value: 42, color: '#ef4444' },
    { name: 'Cooling', value: 22, color: '#3b82f6' },
    { name: 'Lighting', value: 20, color: '#eab308' },
    { name: 'Equipment', value: 12, color: '#8b5cf6' },
    { name: 'Other', value: 4, color: '#6b7280' },
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

export default function BuildingInsightsView({ facility, onBack }: BuildingInsightsViewProps) {
    const { allData } = useContext(AppContext);

    // Calculate actual stats from allData for this building
    const stats = useMemo(() => {
        const spaces = allData.filter(
            (a: any) => a.category === 'Space' && a.buildingFmGuid === facility.fmGuid
        );
        const storeys = allData.filter(
            (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === facility.fmGuid
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

        return { 
            floorCount: storeys.length,
            roomCount: spaces.length, 
            totalArea: Math.round(totalArea)
        };
    }, [allData, facility.fmGuid]);

    // Floor-by-floor energy data
    const energyByFloor = useMemo(() => {
        const storeys = allData.filter(
            (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === facility.fmGuid
        );
        return storeys.slice(0, 6).map((storey: any, index: number) => ({
            name: storey.commonName || storey.name || `Floor ${index + 1}`,
            kwhPerSqm: Math.round(80 + Math.random() * 60),
            color: index % 2 === 0 ? '#22c55e' : '#eab308'
        }));
    }, [allData, facility.fmGuid]);

    const kpiCards = [
        { 
            title: 'Floors', 
            value: stats.floorCount, 
            icon: Layers, 
            color: 'text-blue-500'
        },
        { 
            title: 'Rooms', 
            value: stats.roomCount, 
            icon: DoorOpen, 
            color: 'text-green-500'
        },
        { 
            title: 'Area (m²)', 
            value: stats.totalArea.toLocaleString(), 
            icon: Building2, 
            color: 'text-primary'
        },
        { 
            title: 'Avg. Energy', 
            value: `${Math.round(85 + Math.random() * 30)} kWh/m²`, 
            icon: Zap, 
            trend: '-5%', 
            trendUp: false,
            color: 'text-yellow-500'
        },
        { 
            title: 'CO₂ (ton/year)', 
            value: Math.round((stats.totalArea * 0.015)).toLocaleString(), 
            icon: Leaf, 
            trend: '-8%', 
            trendUp: false,
            color: 'text-green-500'
        },
        { 
            title: 'Energy Rating', 
            value: 'B', 
            icon: Gauge, 
            color: 'text-primary'
        },
    ];

    return (
        <div className="h-full p-3 sm:p-4 md:p-6 overflow-y-auto">
            {/* Page Header */}
            <div className="mb-6 flex items-start gap-3">
                <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-foreground">
                        {facility.commonName || facility.name}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Energy efficiency and performance analytics
                    </p>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
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
                {/* Energy per Floor Bar Chart */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            Energy per Floor
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
                                        dataKey="name" 
                                        type="category" 
                                        width={80} 
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
                                        {energyByFloor.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

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
