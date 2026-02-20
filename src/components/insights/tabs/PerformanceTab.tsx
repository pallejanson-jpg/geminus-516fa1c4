import React, { useContext, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, Zap, TrendingDown, TrendingUp, Leaf, 
    ThermometerSun, Droplets, Gauge, ChevronsUpDown, Check, Search
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Facility } from '@/lib/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command';
import type { MapColoringMode } from '@/lib/map-coloring-utils';

// Mockup indicator badge
const MockBadge = () => (
    <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30 ml-1">
        Demo
    </Badge>
);

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
    onColorMap?: (mode: MapColoringMode) => void;
}

// Truncate name for chart display
const truncateName = (name: string, maxLen = 12) => 
    name.length > maxLen ? name.substring(0, maxLen) + '...' : name;

export default function PerformanceTab({ onSelectBuilding }: PerformanceTabProps) {
    const { navigatorTreeData } = useContext(AppContext);
    const isMobile = useIsMobile();

    // Calculate actual stats from tree data (REAL)
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

    // Generate energy data for actual buildings (MOCK values, REAL building names)
    const energyByBuilding = useMemo(() => {
        return navigatorTreeData.slice(0, 8).map((building) => {
            const hash = building.fmGuid?.split('').reduce((a, c) => a + c.charCodeAt(0), 0) || 0;
            const kwhPerSqm = 80 + (hash % 70);
            let rating = 'C';
            let color = 'hsl(48, 96%, 53%)';
            
            if (kwhPerSqm < 90) { rating = 'A'; color = 'hsl(142, 76%, 36%)'; }
            else if (kwhPerSqm < 100) { rating = 'B'; color = 'hsl(142, 71%, 45%)'; }
            else if (kwhPerSqm < 120) { rating = 'C'; color = 'hsl(48, 96%, 53%)'; }
            else if (kwhPerSqm < 140) { rating = 'D'; color = 'hsl(24, 95%, 53%)'; }
            else { rating = 'E'; color = 'hsl(var(--destructive))'; }
            
            const fullName = building.commonName || building.name || 'Building';
            return {
                fmGuid: building.fmGuid,
                name: truncateName(fullName),
                fullName,
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
            title: isMobile ? 'Buildings' : 'Building Count', 
            value: stats.buildingCount, 
            icon: Building2, 
            trend: '+2', 
            trendUp: true,
            color: 'text-primary',
            isMock: false,
        },
        { 
            title: isMobile ? 'Energy' : 'Avg. Energy (kWh/m²)', 
            value: energyByBuilding.length > 0 
                ? Math.round(energyByBuilding.reduce((s, b) => s + b.kwhPerSqm, 0) / energyByBuilding.length)
                : 'N/A', 
            icon: Zap, 
            trend: '-8%', 
            trendUp: false,
            color: 'text-yellow-500',
            isMock: true,
        },
        { 
            title: isMobile ? 'CO₂ (tons)' : 'CO₂ Emissions (tons)', 
            value: Math.round(stats.totalArea * 0.012).toLocaleString(), 
            icon: Leaf, 
            trend: '-12%', 
            trendUp: false,
            color: 'text-green-500',
            isMock: true,
        },
        { 
            title: isMobile ? 'Rating' : 'Avg. Energy Rating', 
            value: 'B+', 
            icon: Gauge, 
            trend: 'Improved', 
            trendUp: true,
            color: 'text-primary',
            isMock: true,
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

    // Mobile-friendly pie chart label
    const renderPieLabel = isMobile 
        ? undefined 
        : ({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`;

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {kpiCards.map((kpi, index) => (
                    <Card key={index}>
                        <CardContent className="p-3 sm:p-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1">
                                    <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color} flex-shrink-0`} />
                                    {kpi.isMock && <MockBadge />}
                                </div>
                                <Badge 
                                    variant={kpi.trendUp ? "default" : "secondary"} 
                                    className={`text-[10px] sm:text-xs ${kpi.isMock ? 'bg-purple-600' : kpi.trendUp ? 'bg-green-600' : 'bg-blue-600'}`}
                                >
                                    {kpi.trendUp ? <TrendingUp className="h-3 w-3 mr-0.5 sm:mr-1" /> : <TrendingDown className="h-3 w-3 mr-0.5 sm:mr-1" />}
                                    <span className="hidden sm:inline">{kpi.trend}</span>
                                    <span className="sm:hidden">{kpi.trend.replace('%', '')}</span>
                                </Badge>
                            </div>
                            <p className={`text-xl sm:text-2xl font-bold truncate ${kpi.isMock ? 'text-purple-400' : 'text-foreground'}`}>
                                {kpi.value}
                            </p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Building Selector - compact searchable combobox */}
            <Card>
                <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary flex-shrink-0" />
                        <span className="text-sm font-medium text-foreground">Select building</span>
                        <Popover>
                            <PopoverTrigger asChild>
                                <button className="flex-1 flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                                    <span className="text-muted-foreground">Search buildings...</span>
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[320px] p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="Search buildings..." />
                                    <CommandList>
                                        <CommandEmpty>No buildings found.</CommandEmpty>
                                        {navigatorTreeData.map((building) => {
                                            const energyData = energyByBuilding.find(b => b.fmGuid === building.fmGuid);
                                            return (
                                                <CommandItem
                                                    key={building.fmGuid}
                                                    value={building.commonName || building.name || ''}
                                                    onSelect={() => onSelectBuilding(building as Facility)}
                                                    className="flex items-center justify-between"
                                                >
                                                    <span className="truncate">{building.commonName || building.name}</span>
                                                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                                                        <Badge 
                                                            variant="secondary" 
                                                            className="text-[10px] px-1.5 text-purple-300 bg-purple-500/20 border-purple-500/30"
                                                        >
                                                            {energyData?.rating || 'C'}
                                                        </Badge>
                                                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                            {energyData?.kwhPerSqm || '?'} kWh/m²
                                                        </span>
                                                    </div>
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                </CardContent>
            </Card>

            {/* Charts Grid - ALL MOCK */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Energy per Building Bar Chart */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            <span className="text-purple-400">Energy Consumption per Building</span>
                            <MockBadge />
                        </CardTitle>
                        <CardDescription>kWh per m² (lower is better)</CardDescription>
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
                                        width={isMobile ? 60 : 100} 
                                        className="text-xs"
                                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }}
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
                            <span className="text-purple-400">Energy Distribution by Category</span>
                            <MockBadge />
                        </CardTitle>
                        <CardDescription>Breakdown of energy usage</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={energyDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={isMobile ? 40 : 50}
                                        outerRadius={isMobile ? 65 : 80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={renderPieLabel}
                                        labelLine={!isMobile}
                                    >
                                        {energyDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Monthly Trend - MOCK */}
            <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
                <Card className="lg:col-span-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Droplets className="h-4 w-4 text-blue-500" />
                            <span className="text-purple-400">Monthly Energy Trend</span>
                            <MockBadge />
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
                            <span className="text-purple-400">Energy Ratings</span>
                            <MockBadge />
                        </CardTitle>
                        <CardDescription>Buildings per rating</CardDescription>
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
                                            {item.count} {item.count === 1 ? 'building' : 'buildings'}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-4">
                            Goal: All buildings rating B or better by 2030
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
