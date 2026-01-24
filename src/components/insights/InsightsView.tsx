import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, Zap, TrendingDown, TrendingUp, Leaf, 
    ThermometerSun, Droplets, Gauge
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';

// Mock data for energy efficiency
const energyByBuilding = [
    { name: 'Kv. Glansen 1', kwh: 145, kwhPerSqm: 98, rating: 'B', color: '#22c55e' },
    { name: 'Kv. Glansen 2', kwh: 178, kwhPerSqm: 112, rating: 'C', color: '#eab308' },
    { name: 'Kv. Norrmalm', kwh: 210, kwhPerSqm: 145, rating: 'D', color: '#f97316' },
    { name: 'Kv. Södermalm', kwh: 125, kwhPerSqm: 78, rating: 'A', color: '#16a34a' },
    { name: 'Kv. Östermalm', kwh: 165, kwhPerSqm: 105, rating: 'C', color: '#eab308' },
];

const energyDistribution = [
    { name: 'Heating', value: 45, color: '#ef4444' },
    { name: 'Cooling', value: 20, color: '#3b82f6' },
    { name: 'Lighting', value: 18, color: '#eab308' },
    { name: 'Equipment', value: 12, color: '#8b5cf6' },
    { name: 'Other', value: 5, color: '#6b7280' },
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

const ratingDistribution = [
    { rating: 'A', count: 2, color: '#16a34a' },
    { rating: 'B', count: 5, color: '#22c55e' },
    { rating: 'C', count: 8, color: '#eab308' },
    { rating: 'D', count: 3, color: '#f97316' },
    { rating: 'E', count: 1, color: '#ef4444' },
];

export default function InsightsView() {
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
                    const area = space.grossArea || space.attributes?.grossArea || 0;
                    totalArea += Number(area) || 0;
                });
            });
        });

        return { buildingCount, totalRooms, totalArea };
    }, [navigatorTreeData]);

    const kpiCards = [
        { 
            title: 'Total Buildings', 
            value: stats.buildingCount || 5, 
            icon: Building2, 
            trend: '+2', 
            trendUp: true,
            color: 'text-blue-500'
        },
        { 
            title: 'Avg. Energy (kWh/m²)', 
            value: '107.6', 
            icon: Zap, 
            trend: '-8%', 
            trendUp: false,
            color: 'text-yellow-500'
        },
        { 
            title: 'CO₂ Emissions (ton)', 
            value: '1,245', 
            icon: Leaf, 
            trend: '-12%', 
            trendUp: false,
            color: 'text-green-500'
        },
        { 
            title: 'Energy Rating Avg.', 
            value: 'B+', 
            icon: Gauge, 
            trend: 'Improved', 
            trendUp: true,
            color: 'text-primary'
        },
    ];

    return (
        <div className="h-full p-3 sm:p-4 md:p-6 overflow-y-auto">
            {/* Page Header */}
            <div className="mb-6">
                <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Insights</h1>
                <p className="text-sm text-muted-foreground">
                    Energy efficiency overview and building performance analytics
                </p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
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

            {/* Charts Grid */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
                {/* Energy per Building Bar Chart */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            Energy Consumption per Building
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
                            Energy Distribution by Category
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

                {/* Rating Distribution */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-primary" />
                            Energy Ratings
                        </CardTitle>
                        <CardDescription>Buildings by rating class</CardDescription>
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
                                                width: `${(item.count / 8) * 100}%`,
                                                minWidth: '40px'
                                            }}
                                        >
                                            {item.count} buildings
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-4">
                            Target: All buildings at rating B or better by 2030
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
