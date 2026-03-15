import React, { useContext, useMemo } from 'react';
import { extractSpaceArea } from '@/lib/building-utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
    LayoutGrid, Users, TrendingUp, SquareStack,
    Building2, Maximize2, Percent
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useIsMobile } from '@/hooks/use-mobile';

// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

// Truncate name for chart display
const truncateName = (name: string, maxLen = 12) => 
    name.length > maxLen ? name.substring(0, maxLen) + '...' : name;


interface SpaceManagementTabProps {
    onNavigateToRooms?: (buildingFmGuid?: string) => void;
}

export default function SpaceManagementTab({ onNavigateToRooms }: SpaceManagementTabProps) {
    const { navigatorTreeData } = useContext(AppContext);
    const isMobile = useIsMobile();

    // Calculate actual space stats (REAL)
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

                    const spaceType = attrs.spaceType || attrs.roomType || 'Unknown';
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

    // Building occupancy data - spaceCount/totalArea are REAL, occupancy/vacancy are MOCK
    const occupancyData = useMemo(() => {
        return navigatorTreeData.slice(0, 8).map((building) => {
            const hash = hashString(building.fmGuid || '');
            let spaceCount = 0;
            let totalArea = 0;
            
            building.children?.forEach(storey => {
                storey.children?.forEach(space => {
                    spaceCount++;
                    totalArea += extractSpaceArea(space);
                });
            });

            const fullName = building.commonName || building.name || 'Building';
            return {
                fmGuid: building.fmGuid,
                name: truncateName(fullName),
                fullName,
                occupancy: 55 + (hash % 40), // MOCK
                spaceCount, // REAL
                totalArea: Math.round(totalArea), // REAL
                vacancy: 5 + (hash % 15), // MOCK
            };
        });
    }, [navigatorTreeData]);

    // Space type distribution for pie chart (REAL)
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
            title: isMobile ? 'Rooms' : 'Total Rooms', 
            value: spaceStats.totalSpaces.toLocaleString(), 
            icon: LayoutGrid, 
            color: 'text-primary',
            isMock: false,
            clickable: true,
        },
        { 
            title: isMobile ? 'Area (m²)' : 'Total Area (m²)', 
            value: spaceStats.totalArea.toLocaleString(), 
            icon: Maximize2, 
            color: 'text-blue-500',
            isMock: false,
        },
        { 
            title: isMobile ? 'Occupancy' : 'Average Occupancy', 
            value: `${Math.round(occupancyData.reduce((s, b) => s + b.occupancy, 0) / Math.max(occupancyData.length, 1))}%`, 
            icon: Users, 
            color: 'text-green-500',
            isMock: true,
        },
        { 
            title: isMobile ? 'Vacancy' : 'Avg. Vacancy Rate', 
            value: `${Math.round(occupancyData.reduce((s, b) => s + b.vacancy, 0) / Math.max(occupancyData.length, 1))}%`, 
            icon: Percent, 
            color: 'text-yellow-500',
            isMock: true,
        },
    ];

    // Mobile-friendly pie chart label
    const renderPieLabel = isMobile 
        ? undefined 
        : ({ name, value }: any) => `${name} (${value})`;

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {kpiCards.map((kpi, index) => (
                    <Card 
                        key={index}
                        className={kpi.clickable ? 'cursor-pointer hover:border-primary/50 transition-colors' : ''}
                        onClick={() => kpi.clickable && onNavigateToRooms?.()}
                    >
                        <CardContent className="p-3 sm:p-4">
                            <div className="flex items-center gap-1.5 mb-2">
                                <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color} flex-shrink-0`} />
                                
                            </div>
                            <p className="text-xl sm:text-2xl font-bold truncate text-foreground">
                                {kpi.value}
                            </p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Occupancy per Building - MOCK */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary" />
                            Occupancy per Building
                        </CardTitle>
                        <CardDescription>Percent of available space</CardDescription>
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
                                        width={isMobile ? 60 : 100}
                                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }}
                                    />
                                    <Bar 
                                        dataKey="occupancy" 
                                        name="Occupancy"
                                        fill="hsl(262, 83%, 58%)"
                                        radius={[0, 4, 4, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Space Type Distribution - REAL */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <SquareStack className="h-4 w-4 text-blue-500" />
                            Room Types
                        </CardTitle>
                        <CardDescription>Distribution by category (real data)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={spaceTypeDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={isMobile ? 40 : 50}
                                        outerRadius={isMobile ? 65 : 80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={renderPieLabel}
                                        labelLine={!isMobile}
                                    >
                                        {spaceTypeDistribution.map((entry, index) => (
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

            {/* Building Overview */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        Space Efficiency per Building
                    </CardTitle>
                    <CardDescription>Occupancy and vacancy rates</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {occupancyData.slice(0, 8).map((building) => (
                            <div key={building.fmGuid} className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium truncate max-w-[200px]">{building.fullName}</span>
                                    <div className="flex items-center gap-4 text-muted-foreground">
                                        <span 
                                            className="text-foreground cursor-pointer hover:text-primary underline-offset-2 hover:underline"
                                            onClick={() => onNavigateToRooms?.(building.fmGuid)}
                                        >
                                            {building.spaceCount} rooms
                                        </span>
                                        <span className="text-foreground">{building.totalArea.toLocaleString()} m²</span>
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
