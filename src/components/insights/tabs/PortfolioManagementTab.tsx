import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, TrendingUp, CircleDollarSign, MapPin,
    Briefcase, BarChart3, Shield
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

export default function PortfolioManagementTab() {
    const { navigatorTreeData } = useContext(AppContext);

    // Portfolio data per building
    const portfolioData = useMemo(() => {
        return navigatorTreeData.map((building) => {
            const hash = hashString(building.fmGuid || '');
            
            // Count spaces for area estimation
            let totalArea = 0;
            building.children?.forEach(storey => {
                storey.children?.forEach(space => {
                    const attrs = space.attributes || {};
                    const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
                    totalArea += ntaKey ? Number(attrs[ntaKey]) : (space.grossArea || 0);
                });
            });

            return {
                fmGuid: building.fmGuid,
                name: building.commonName || building.name || 'Byggnad',
                marketValue: 20000000 + (hash % 80000000),
                annualRent: 1000000 + (hash % 5000000),
                roi: 3 + (hash % 7) + (hash % 10) / 10,
                occupancy: 70 + (hash % 25),
                riskLevel: hash % 100 > 70 ? 'Hög' : hash % 100 > 30 ? 'Medel' : 'Låg',
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
        const low = portfolioData.filter(b => b.riskLevel === 'Låg').length;
        const medium = portfolioData.filter(b => b.riskLevel === 'Medel').length;
        const high = portfolioData.filter(b => b.riskLevel === 'Hög').length;
        return [
            { name: 'Låg risk', value: low, color: 'hsl(142, 71%, 45%)' },
            { name: 'Medel risk', value: medium, color: 'hsl(48, 96%, 53%)' },
            { name: 'Hög risk', value: high, color: 'hsl(var(--destructive))' },
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
        { month: 'Okt', value: 100 },
        { month: 'Nov', value: 101 },
        { month: 'Dec', value: 102 },
        { month: 'Jan', value: 100 },
    ].map(m => ({
        ...m,
        value: (m.value / 100) * totals.totalValue,
    }));

    const kpiCards = [
        { 
            title: 'Totalt portföljvärde', 
            value: `${(totals.totalValue / 1000000).toFixed(0)} MSEK`, 
            icon: CircleDollarSign, 
            color: 'text-primary'
        },
        { 
            title: 'Årlig hyresintäkt', 
            value: `${(totals.totalRent / 1000000).toFixed(1)} MSEK`, 
            icon: Briefcase, 
            color: 'text-green-500'
        },
        { 
            title: 'Genomsnittlig ROI', 
            value: `${totals.avgRoi.toFixed(1)}%`, 
            icon: TrendingUp, 
            color: 'text-blue-500'
        },
        { 
            title: 'Snitt uthyrningsgrad', 
            value: `${totals.avgOccupancy}%`, 
            icon: Building2, 
            color: 'text-yellow-500'
        },
    ];

    const getRiskBadge = (risk: string) => {
        switch (risk) {
            case 'Låg':
                return <Badge className="bg-green-600">Låg</Badge>;
            case 'Medel':
                return <Badge className="bg-yellow-600">Medel</Badge>;
            case 'Hög':
                return <Badge variant="destructive">Hög</Badge>;
            default:
                return <Badge variant="secondary">{risk}</Badge>;
        }
    };

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
                {/* Value per Building */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-primary" />
                            Marknadsvärde per byggnad
                        </CardTitle>
                        <CardDescription>Värdering i MSEK</CardDescription>
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
                                        width={100}
                                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                                    />
                                    <Tooltip 
                                        contentStyle={{ 
                                            backgroundColor: 'hsl(var(--popover))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '8px'
                                        }}
                                        formatter={(value: number) => [`${value.toFixed(1)} MSEK`, 'Värde']}
                                    />
                                    <Bar 
                                        dataKey="valueInMillions" 
                                        name="Värde (MSEK)"
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
                            <Shield className="h-4 w-4 text-blue-500" />
                            Riskprofil
                        </CardTitle>
                        <CardDescription>Byggnader per risknivå</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={riskDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, value }) => `${name}: ${value}`}
                                        labelLine={false}
                                    >
                                        {riskDistribution.map((entry, index) => (
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

            {/* Value Trend */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        Portföljvärdering över tid
                    </CardTitle>
                    <CardDescription>Senaste 6 månaderna (MSEK)</CardDescription>
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
                                <Tooltip 
                                    contentStyle={{ 
                                        backgroundColor: 'hsl(var(--popover))',
                                        border: '1px solid hsl(var(--border))',
                                        borderRadius: '8px'
                                    }}
                                    formatter={(value: number) => [`${(value / 1000000).toFixed(1)} MSEK`, 'Värde']}
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
                        Fastighetsportfölj
                    </CardTitle>
                    <CardDescription>Ekonomisk översikt per byggnad</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Byggnad</TableHead>
                                    <TableHead className="text-right">Värde</TableHead>
                                    <TableHead className="text-right">Hyra/år</TableHead>
                                    <TableHead className="text-right">ROI</TableHead>
                                    <TableHead className="text-right">Uthyrning</TableHead>
                                    <TableHead className="text-right">Risk</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {portfolioData.slice(0, 10).map((building) => (
                                    <TableRow key={building.fmGuid}>
                                        <TableCell className="font-medium">{building.name}</TableCell>
                                        <TableCell className="text-right">
                                            {(building.marketValue / 1000000).toFixed(1)} MSEK
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {(building.annualRent / 1000).toFixed(0)} kSEK
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <span className={building.roi >= 5 ? 'text-green-500' : 'text-muted-foreground'}>
                                                {building.roi.toFixed(1)}%
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">{building.occupancy}%</TableCell>
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
