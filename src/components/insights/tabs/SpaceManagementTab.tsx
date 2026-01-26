import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
    LayoutGrid, Users, TrendingUp, SquareStack,
    Building2, Maximize2, Percent
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

export default function SpaceManagementTab() {
    const { navigatorTreeData } = useContext(AppContext);

    // Calculate actual space stats
    const spaceStats = useMemo(() => {
        let totalSpaces = 0;
        let totalArea = 0;
        const spaceTypes: Record<string, { count: number; area: number }> = {};

        navigatorTreeData.forEach(building => {
            building.children?.forEach(storey => {
                storey.children?.forEach(space => {
                    totalSpaces++;
                    const attrs = space.attributes || {};
                    const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
                    const area = ntaKey ? Number(attrs[ntaKey]) : (space.grossArea || 0);
                    totalArea += area;

                    // Categorize by space type
                    const spaceType = attrs.spaceType || attrs.roomType || 'Okänd';
                    if (!spaceTypes[spaceType]) {
                        spaceTypes[spaceType] = { count: 0, area: 0 };
                    }
                    spaceTypes[spaceType].count++;
                    spaceTypes[spaceType].area += area;
                });
            });
        });

        return { totalSpaces, totalArea: Math.round(totalArea), spaceTypes };
    }, [navigatorTreeData]);

    // Building occupancy data
    const occupancyData = useMemo(() => {
        return navigatorTreeData.slice(0, 8).map((building) => {
            const hash = hashString(building.fmGuid || '');
            let spaceCount = 0;
            let totalArea = 0;
            
            building.children?.forEach(storey => {
                storey.children?.forEach(space => {
                    spaceCount++;
                    const attrs = space.attributes || {};
                    const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
                    totalArea += ntaKey ? Number(attrs[ntaKey]) : (space.grossArea || 0);
                });
            });

            return {
                fmGuid: building.fmGuid,
                name: building.commonName || building.name || 'Byggnad',
                occupancy: 55 + (hash % 40),
                spaceCount,
                totalArea: Math.round(totalArea),
                vacancy: 5 + (hash % 15),
            };
        });
    }, [navigatorTreeData]);

    // Space type distribution for pie chart
    const spaceTypeDistribution = useMemo(() => {
        const colors = [
            'hsl(var(--primary))',
            'hsl(220, 80%, 55%)',
            'hsl(142, 71%, 45%)',
            'hsl(48, 96%, 53%)',
            'hsl(262, 83%, 58%)',
            'hsl(var(--muted-foreground))',
        ];
        
        return Object.entries(spaceStats.spaceTypes)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 6)
            .map(([name, data], index) => ({
                name: name.length > 15 ? name.substring(0, 15) + '...' : name,
                value: data.count,
                area: Math.round(data.area),
                color: colors[index % colors.length],
            }));
    }, [spaceStats]);

    const kpiCards = [
        { 
            title: 'Totalt antal rum', 
            value: spaceStats.totalSpaces.toLocaleString('sv-SE'), 
            icon: LayoutGrid, 
            color: 'text-primary'
        },
        { 
            title: 'Total yta (m²)', 
            value: spaceStats.totalArea.toLocaleString('sv-SE'), 
            icon: Maximize2, 
            color: 'text-blue-500'
        },
        { 
            title: 'Genomsnittlig beläggning', 
            value: `${Math.round(occupancyData.reduce((s, b) => s + b.occupancy, 0) / occupancyData.length)}%`, 
            icon: Users, 
            color: 'text-green-500'
        },
        { 
            title: 'Snitt vakansgrad', 
            value: `${Math.round(occupancyData.reduce((s, b) => s + b.vacancy, 0) / occupancyData.length)}%`, 
            icon: Percent, 
            color: 'text-yellow-500'
        },
    ];

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {kpiCards.map((kpi, index) => (
                    <Card key={index}>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                            </div>
                            <p className="text-2xl font-bold">{kpi.value}</p>
                            <p className="text-xs text-muted-foreground">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Occupancy per Building */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary" />
                            Beläggning per byggnad
                        </CardTitle>
                        <CardDescription>Procent av tillgänglig yta</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={occupancyData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                    <XAxis type="number" domain={[0, 100]} />
                                    <YAxis 
                                        dataKey="name" 
                                        type="category" 
                                        width={100}
                                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                                    />
                                    <Tooltip 
                                        contentStyle={{ 
                                            backgroundColor: 'hsl(var(--popover))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '8px'
                                        }}
                                        formatter={(value: number) => [`${value}%`, 'Beläggning']}
                                    />
                                    <Bar 
                                        dataKey="occupancy" 
                                        name="Beläggning"
                                        fill="hsl(var(--primary))"
                                        radius={[0, 4, 4, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Space Type Distribution */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <SquareStack className="h-4 w-4 text-blue-500" />
                            Rumstyper
                        </CardTitle>
                        <CardDescription>Fördelning per kategori</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={spaceTypeDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        labelLine={false}
                                    >
                                        {spaceTypeDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip 
                                        contentStyle={{ 
                                            backgroundColor: 'hsl(var(--popover))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '8px'
                                        }}
                                        formatter={(value: number, name: string, props: any) => [
                                            `${value} rum (${props.payload.area.toLocaleString('sv-SE')} m²)`,
                                            name
                                        ]}
                                    />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Building Overview */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        Yteffektivitet per byggnad
                    </CardTitle>
                    <CardDescription>Beläggning och vakansgrad</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {occupancyData.slice(0, 8).map((building) => (
                            <div key={building.fmGuid} className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium truncate max-w-[200px]">{building.name}</span>
                                    <div className="flex items-center gap-4 text-muted-foreground">
                                        <span>{building.spaceCount} rum</span>
                                        <span>{building.totalArea.toLocaleString('sv-SE')} m²</span>
                                        <Badge variant={building.occupancy >= 80 ? "default" : "secondary"}>
                                            {building.occupancy}%
                                        </Badge>
                                    </div>
                                </div>
                                <Progress value={building.occupancy} className="h-2" />
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
