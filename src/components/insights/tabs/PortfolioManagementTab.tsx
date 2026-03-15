import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import {
    Building2, TrendingUp, CircleDollarSign, MapPin,
    Briefcase, BarChart3, Shield
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import type { MapColoringMode } from '@/lib/map-coloring-utils';
import { CHART_COLORS, RISK_COLORS, ICON_COLOR_CLASSES } from '@/lib/chart-theme';

interface PortfolioManagementTabProps {
    onColorMap?: (mode: MapColoringMode) => void;
}


// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

// Truncate name for chart display
const truncateName = (name: string, maxLen = 12) => 
    name.length > maxLen ? name.substring(0, maxLen) + '...' : name;

export default function PortfolioManagementTab({ onColorMap }: PortfolioManagementTabProps) {
    const { navigatorTreeData } = useContext(AppContext);
    const isMobile = useIsMobile();

    // Portfolio data per building
    const portfolioData = useMemo(() => {
        return navigatorTreeData.map((building) => {
            const hash = hashString(building.fmGuid || '');
            
            let totalArea = 0;
            building.children?.forEach(storey => {
                storey.children?.forEach(space => {
                    totalArea += extractSpaceArea(space);
                });
            });

            const fullName = building.commonName || building.name || 'Building';
            return {
                fmGuid: building.fmGuid,
                name: truncateName(fullName),
                fullName,
                marketValue: 20000000 + (hash % 80000000),
                annualRent: 1000000 + (hash % 5000000),
                roi: 3 + (hash % 7) + (hash % 10) / 10,
                occupancy: 70 + (hash % 25),
                riskLevel: hash % 100 > 70 ? 'High' : hash % 100 > 30 ? 'Medium' : 'Low',
                area: Math.round(totalArea),
            };
        });
    }, [navigatorTreeData]);

    // Totals
    const totals = useMemo(() => ({
        totalValue: portfolioData.reduce((s, b) => s + b.marketValue, 0),
        totalRent: portfolioData.reduce((s, b) => s + b.annualRent, 0),
        avgRoi: portfolioData.reduce((s, b) => s + b.roi, 0) / portfolioData.length,
        avgOccupancy: Math.round(portfolioData.reduce((s, b) => s + b.occupancy, 0) / portfolioData.length),
        buildingCount: portfolioData.length,
    }), [portfolioData]);

    // Risk distribution
    const riskDistribution = useMemo(() => {
        const low = portfolioData.filter(b => b.riskLevel === 'Low').length;
        const medium = portfolioData.filter(b => b.riskLevel === 'Medium').length;
        const high = portfolioData.filter(b => b.riskLevel === 'High').length;
        return [
            { name: 'Low Risk', value: low, color: RISK_COLORS.Low },
            { name: 'Medium Risk', value: medium, color: RISK_COLORS.Medium },
            { name: 'High Risk', value: high, color: RISK_COLORS.High },
        ];
    }, [portfolioData]);

    // Value by building for bar chart
    const valueByBuilding = useMemo(() => {
        return portfolioData
            .slice(0, 8)
            .sort((a, b) => b.marketValue - a.marketValue)
            .map(b => ({
                ...b,
                valueInMillions: b.marketValue / 1000000,
            }));
    }, [portfolioData]);

    // Monthly trend data (mock)
    const monthlyTrend = [
        { month: 'Jul', value: 95 },
        { month: 'Aug', value: 97 },
        { month: 'Sep', value: 98 },
        { month: 'Oct', value: 100 },
        { month: 'Nov', value: 101 },
        { month: 'Dec', value: 102 },
        { month: 'Jan', value: 100 },
    ].map(m => ({
        ...m,
        value: (m.value / 100) * totals.totalValue,
    }));

    const kpiCards = [
        { 
            title: isMobile ? 'Value' : 'Total Portfolio Value', 
            value: `${(totals.totalValue / 1000000).toFixed(0)} MSEK`, 
            icon: CircleDollarSign, 
            color: 'text-primary'
        },
        { 
            title: isMobile ? 'Rent/yr' : 'Annual Rental Income', 
            value: `${(totals.totalRent / 1000000).toFixed(1)} MSEK`, 
            icon: Briefcase, 
            color: ICON_COLOR_CLASSES.green
        },
        { 
            title: isMobile ? 'ROI' : 'Average ROI', 
            value: `${totals.avgRoi.toFixed(1)}%`, 
            icon: TrendingUp, 
            color: ICON_COLOR_CLASSES.blue
        },
        { 
            title: isMobile ? 'Occupancy' : 'Avg. Occupancy Rate', 
            value: `${totals.avgOccupancy}%`, 
            icon: Building2, 
            color: ICON_COLOR_CLASSES.amber
        },
    ];

    const getRiskBadge = (risk: string) => {
        switch (risk) {
            case 'Low':
                return <Badge style={{ backgroundColor: RISK_COLORS.Low }} className="text-white">Low</Badge>;
            case 'Medium':
                return <Badge style={{ backgroundColor: RISK_COLORS.Medium }} className="text-white">Medium</Badge>;
            case 'High':
                return <Badge variant="destructive">High</Badge>;
            default:
                return <Badge variant="secondary">{risk}</Badge>;
        }
    };

    // Mobile-friendly pie chart label
    const renderPieLabel = isMobile 
        ? undefined 
        : ({ name, value }: any) => `${name}: ${value}`;

    return (
        <div className="space-y-6">
            {/* KPI Cards - ALL MOCK */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {kpiCards.map((kpi, index) => (
                    <Card key={index}>
                        <CardContent className="p-3 sm:p-4">
                            <div className="flex items-center gap-1.5 mb-2">
                                <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color} flex-shrink-0`} />
                                
                            </div>
                            <p className="text-xl sm:text-2xl font-bold text-foreground truncate">{kpi.value}</p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Value per Building */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-primary" />
                            Market Value per Building
                        </CardTitle>
                        <CardDescription>Valuation in MSEK</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={valueByBuilding} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                    <XAxis type="number" />
                                    <YAxis 
                                        dataKey="name" 
                                        type="category" 
                                        width={isMobile ? 60 : 100}
                                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }}
                                    />
                                    <Bar 
                                        dataKey="valueInMillions" 
                                        name="Value (MSEK)"
                                        fill="hsl(var(--primary))"
                                        radius={[0, 4, 4, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Risk Distribution */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Shield className={`h-4 w-4 ${ICON_COLOR_CLASSES.blue}`} />
                            Risk Profile
                        </CardTitle>
                        <CardDescription>Buildings by risk level</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={riskDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={isMobile ? 40 : 50}
                                        outerRadius={isMobile ? 65 : 80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={renderPieLabel}
                                        labelLine={!isMobile}
                                    >
                                        {riskDistribution.map((entry, index) => (
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

            {/* Value Trend */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className={`h-4 w-4 ${ICON_COLOR_CLASSES.green}`} />
                        Portfolio Valuation Over Time
                    </CardTitle>
                    <CardDescription>Last 6 months (MSEK)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={monthlyTrend}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                <XAxis 
                                    dataKey="month" 
                                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                                />
                                <YAxis 
                                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                                    tickFormatter={(v) => `${(v / 1000000).toFixed(0)}`}
                                />
                                <Line 
                                    type="monotone" 
                                    dataKey="value" 
                                    stroke="hsl(var(--primary))" 
                                    strokeWidth={2}
                                    dot={{ fill: 'hsl(var(--primary))' }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Building Portfolio Table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        Property Portfolio
                    </CardTitle>
                    <CardDescription>Financial overview per building</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Building</TableHead>
                                    <TableHead className="text-right">Value</TableHead>
                                    <TableHead className="text-right">Rent/year</TableHead>
                                    <TableHead className="text-right">ROI</TableHead>
                                    <TableHead className="text-right">Occupancy</TableHead>
                                    <TableHead className="text-right">Risk</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {portfolioData.slice(0, 10).map((building) => (
                                    <TableRow key={building.fmGuid}>
                                        <TableCell className="font-medium text-foreground">{building.fullName}</TableCell>
                                        <TableCell className="text-right text-foreground">
                                            {(building.marketValue / 1000000).toFixed(1)} MSEK
                                        </TableCell>
                                        <TableCell className="text-right text-foreground">
                                            {(building.annualRent / 1000).toFixed(0)} kSEK
                                        </TableCell>
                                        <TableCell className="text-right text-foreground">
                                            {building.roi.toFixed(1)}%
                                        </TableCell>
                                        <TableCell className="text-right text-foreground">{building.occupancy}%</TableCell>
                                        <TableCell className="text-right">
                                            {getRiskBadge(building.riskLevel)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
