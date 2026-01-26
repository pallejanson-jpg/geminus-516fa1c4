import React, { useContext, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, Zap, TrendingDown, TrendingUp, Leaf, 
    ThermometerSun, Droplets, Gauge, ChevronRight
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Facility } from '@/lib/types';

const energyDistribution = [
    { name: 'Heating', value: 45, color: 'hsl(var(--destructive))' },
    { name: 'Cooling', value: 20, color: 'hsl(220, 80%, 55%)' },
    { name: 'Lighting', value: 18, color: 'hsl(48, 96%, 53%)' },
    { name: 'Equipment', value: 12, color: 'hsl(262, 83%, 58%)' },
    { name: 'Other', value: 5, color: 'hsl(var(--muted-foreground))' },
];

const monthlyTrend = [
    { month: 'Jan', consumption: 285, target: 250 },
    { month: 'Feb', consumption: 268, target: 245 },
    { month: 'Mar', consumption: 242, target: 240 },
    { month: 'Apr', consumption: 198, target: 220 },
    { month: 'May', consumption: 165, target: 200 },
    { month: 'Jun', consumption: 145, target: 180 },
    { month: 'Jul', consumption: 158, target: 175 },
    { month: 'Aug', consumption: 162, target: 180 },
    { month: 'Sep', consumption: 185, target: 200 },
    { month: 'Oct', consumption: 215, target: 220 },
    { month: 'Nov', consumption: 255, target: 240 },
    { month: 'Dec', consumption: 278, target: 255 },
];

interface PerformanceTabProps {
    onSelectBuilding: (building: Facility) => void;
}

export default function PerformanceTab({ onSelectBuilding }: PerformanceTabProps) {
    const { navigatorTreeData } = useContext(AppContext);

    // Calculate actual stats from tree data
    const stats = useMemo(() => {
        const buildingCount = navigatorTreeData.length;
        let totalRooms = 0;
        let totalArea = 0;

        navigatorTreeData.forEach(building => {
            building.children?.forEach(storey => {
                storey.children?.forEach(space => {
                    totalRooms++;
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
            });
        });

        return { buildingCount, totalRooms, totalArea: Math.round(totalArea) };
    }, [navigatorTreeData]);

    // Generate energy data for actual buildings (deterministic based on fmGuid)
    const energyByBuilding = useMemo(() => {
        return navigatorTreeData.slice(0, 8).map((building) => {
            // Use fmGuid hash for deterministic random values
            const hash = building.fmGuid?.split('').reduce((a, c) => a + c.charCodeAt(0), 0) || 0;
            const kwhPerSqm = 80 + (hash % 70);
            let rating = 'C';
            let color = 'hsl(48, 96%, 53%)';
            
            if (kwhPerSqm < 90) { rating = 'A'; color = 'hsl(142, 76%, 36%)'; }
            else if (kwhPerSqm < 100) { rating = 'B'; color = 'hsl(142, 71%, 45%)'; }
            else if (kwhPerSqm < 120) { rating = 'C'; color = 'hsl(48, 96%, 53%)'; }
            else if (kwhPerSqm < 140) { rating = 'D'; color = 'hsl(24, 95%, 53%)'; }
            else { rating = 'E'; color = 'hsl(var(--destructive))'; }
            
            return {
                fmGuid: building.fmGuid,
                name: building.commonName || building.name || `Building`,
                kwhPerSqm,
                rating,
                color
            };
        });
    }, [navigatorTreeData]);

    // Rating distribution from actual buildings
    const ratingDistribution = useMemo(() => {
        const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        energyByBuilding.forEach(b => {
            counts[b.rating] = (counts[b.rating] || 0) + 1;
        });
        return [
            { rating: 'A', count: counts.A, color: 'hsl(142, 76%, 36%)' },
            { rating: 'B', count: counts.B, color: 'hsl(142, 71%, 45%)' },
            { rating: 'C', count: counts.C, color: 'hsl(48, 96%, 53%)' },
            { rating: 'D', count: counts.D, color: 'hsl(24, 95%, 53%)' },
            { rating: 'E', count: counts.E, color: 'hsl(var(--destructive))' },
        ];
    }, [energyByBuilding]);

    const kpiCards = [
        { 
            title: 'Antal byggnader', 
            value: stats.buildingCount, 
            icon: Building2, 
            trend: '+2', 
            trendUp: true,
            color: 'text-primary'
        },
        { 
            title: 'Snitt energi (kWh/m²)', 
            value: energyByBuilding.length > 0 
                ? Math.round(energyByBuilding.reduce((s, b) => s + b.kwhPerSqm, 0) / energyByBuilding.length)
                : 'N/A', 
            icon: Zap, 
            trend: '-8%', 
            trendUp: false,
            color: 'text-yellow-500'
        },
        { 
            title: 'CO₂-utsläpp (ton)', 
            value: Math.round(stats.totalArea * 0.012).toLocaleString('sv-SE'), 
            icon: Leaf, 
            trend: '-12%', 
            trendUp: false,
            color: 'text-green-500'
        },
        { 
            title: 'Snitt energiklass', 
            value: 'B+', 
            icon: Gauge, 
            trend: 'Förbättrad', 
            trendUp: true,
            color: 'text-primary'
        },
    ];

    const handleBuildingClick = (data: any) => {
        if (data?.fmGuid) {
            const building = navigatorTreeData.find(b => b.fmGuid === data.fmGuid);
            if (building) {
                onSelectBuilding(building as Facility);
            }
        }
    };

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {kpiCards.map((kpi, index) => (
                    <Card key={index}>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-2">
                                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                                <Badge 
                                    variant={kpi.trendUp ? "default" : "secondary"} 
                                    className={`text-xs ${kpi.trendUp ? 'bg-green-600' : 'bg-blue-600'}`}
                                >
                                    {kpi.trendUp ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                                    {kpi.trend}
                                </Badge>
                            </div>
                            <p className="text-2xl font-bold">{kpi.value}</p>
                            <p className="text-xs text-muted-foreground">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Building List */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        Byggnader
                    </CardTitle>
                    <CardDescription>Klicka på en byggnad för detaljerade insikter</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {navigatorTreeData.map((building) => {
                            const energyData = energyByBuilding.find(b => b.fmGuid === building.fmGuid);
                            return (
                                <Button
                                    key={building.fmGuid}
                                    variant="outline"
                                    className="h-auto p-3 flex items-center justify-between gap-2 text-left"
                                    onClick={() => onSelectBuilding(building as Facility)}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium text-sm truncate">
                                            {building.commonName || building.name}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge 
                                                variant="secondary" 
                                                className="text-[10px] px-1.5 text-white"
                                                style={{ backgroundColor: energyData?.color }}
                                            >
                                                {energyData?.rating || 'C'}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {energyData?.kwhPerSqm || '?'} kWh/m²
                                            </span>
                                        </div>
                                    </div>
                                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                </Button>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* Charts Grid */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Energy per Building Bar Chart */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            Energiförbrukning per byggnad
                        </CardTitle>
                        <CardDescription>kWh per m² (lägre är bättre)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={energyByBuilding} layout="vertical">
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
                                        cursor="pointer"
                                        onClick={(data) => handleBuildingClick(data)}
                                    >
                                        {energyByBuilding.map((entry, index) => (
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
                            Energifördelning per kategori
                        </CardTitle>
                        <CardDescription>Nedbrytning av energianvändning</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={energyDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
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

            {/* Monthly Trend */}
            <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
                <Card className="lg:col-span-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Droplets className="h-4 w-4 text-blue-500" />
                            Månatlig energitrend
                        </CardTitle>
                        <CardDescription>Faktisk vs målförbrukning (MWh)</CardDescription>
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
                                        name="Faktisk"
                                        stroke="hsl(var(--primary))" 
                                        strokeWidth={2}
                                        dot={{ fill: 'hsl(var(--primary))' }}
                                    />
                                    <Line 
                                        type="monotone" 
                                        dataKey="target" 
                                        name="Mål"
                                        stroke="hsl(142, 71%, 45%)" 
                                        strokeWidth={2}
                                        strokeDasharray="5 5"
                                        dot={{ fill: 'hsl(142, 71%, 45%)' }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Rating Distribution */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-primary" />
                            Energiklasser
                        </CardTitle>
                        <CardDescription>Byggnader per klass</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {ratingDistribution.map((item) => (
                                <div key={item.rating} className="flex items-center gap-3">
                                    <div 
                                        className="w-8 h-8 rounded-md flex items-center justify-center text-white font-bold text-sm"
                                        style={{ backgroundColor: item.color }}
                                    >
                                        {item.rating}
                                    </div>
                                    <div className="flex-1">
                                        <div 
                                            className="h-6 rounded-md flex items-center px-2 text-xs font-medium text-white"
                                            style={{ 
                                                backgroundColor: item.color,
                                                width: item.count > 0 ? `${Math.max((item.count / Math.max(...ratingDistribution.map(r => r.count), 1)) * 100, 20)}%` : '20%',
                                                minWidth: '40px'
                                            }}
                                        >
                                            {item.count} byggnader
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-4">
                            Mål: Alla byggnader klass B eller bättre till 2030
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
