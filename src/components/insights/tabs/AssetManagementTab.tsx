import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
    Package, Wrench, CircleDollarSign, Clock,
    Building2, AlertCircle, CheckCircle2
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';

// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

// Truncate name for chart display
const truncateName = (name: string, maxLen = 12) => 
    name.length > maxLen ? name.substring(0, maxLen) + '...' : name;

export default function AssetManagementTab() {
    const { navigatorTreeData, allData } = useContext(AppContext);
    const isMobile = useIsMobile();

    // Count assets from allData
    const assetStats = useMemo(() => {
        const assets = allData.filter(item => 
            item.category !== 'Building' && 
            item.category !== 'Building Storey' && 
            item.category !== 'Space'
        );
        
        const categories: Record<string, number> = {};
        assets.forEach(asset => {
            const cat = asset.assetType || asset.category || 'Unknown';
            categories[cat] = (categories[cat] || 0) + 1;
        });

        return {
            totalAssets: assets.length,
            categories,
        };
    }, [allData]);

    // Asset data per building
    const assetsByBuilding = useMemo(() => {
        return navigatorTreeData.slice(0, 10).map((building) => {
            const hash = hashString(building.fmGuid || '');
            const fullName = building.commonName || building.name || 'Building';
            return {
                fmGuid: building.fmGuid,
                name: truncateName(fullName),
                fullName,
                assetCount: 20 + (hash % 80),
                avgAge: 3 + (hash % 12),
                replacementValue: 500000 + (hash % 2000000),
                maintenanceStatus: hash % 100 > 70 ? 'Critical' : hash % 100 > 40 ? 'Planned' : 'OK',
            };
        });
    }, [navigatorTreeData]);

    // Totals
    const totals = useMemo(() => ({
        totalAssets: assetsByBuilding.reduce((s, b) => s + b.assetCount, 0),
        avgAge: Math.round(assetsByBuilding.reduce((s, b) => s + b.avgAge, 0) / assetsByBuilding.length),
        totalValue: assetsByBuilding.reduce((s, b) => s + b.replacementValue, 0),
        needsMaintenance: assetsByBuilding.filter(b => b.maintenanceStatus !== 'OK').length,
    }), [assetsByBuilding]);

    // Asset category distribution
    const categoryDistribution = [
        { name: 'HVAC', value: 28, color: 'hsl(220, 80%, 55%)' },
        { name: 'Electrical', value: 22, color: 'hsl(48, 96%, 53%)' },
        { name: 'Elevators', value: 8, color: 'hsl(var(--primary))' },
        { name: 'Security', value: 15, color: 'hsl(var(--destructive))' },
        { name: 'Plumbing', value: 18, color: 'hsl(142, 71%, 45%)' },
        { name: 'Other', value: 9, color: 'hsl(var(--muted-foreground))' },
    ];

    // Maintenance status distribution
    const maintenanceDistribution = useMemo(() => {
        const ok = assetsByBuilding.filter(b => b.maintenanceStatus === 'OK').length;
        const planned = assetsByBuilding.filter(b => b.maintenanceStatus === 'Planned').length;
        const critical = assetsByBuilding.filter(b => b.maintenanceStatus === 'Critical').length;
        return [
            { name: 'OK', value: ok, color: 'hsl(142, 71%, 45%)' },
            { name: 'Planned', value: planned, color: 'hsl(48, 96%, 53%)' },
            { name: 'Critical', value: critical, color: 'hsl(var(--destructive))' },
        ];
    }, [assetsByBuilding]);

    const kpiCards = [
        { 
            title: 'Total Assets', 
            value: totals.totalAssets.toLocaleString(), 
            icon: Package, 
            color: 'text-primary'
        },
        { 
            title: 'Average Age (years)', 
            value: totals.avgAge, 
            icon: Clock, 
            color: 'text-blue-500'
        },
        { 
            title: 'Replacement Value', 
            value: `${(totals.totalValue / 1000000).toFixed(1)} MSEK`, 
            icon: CircleDollarSign, 
            color: 'text-green-500'
        },
        { 
            title: 'Needs Maintenance', 
            value: totals.needsMaintenance, 
            icon: Wrench, 
            color: 'text-yellow-500'
        },
    ];

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'OK':
                return <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>;
            case 'Planned':
                return <Badge className="bg-yellow-600"><Clock className="h-3 w-3 mr-1" />Planned</Badge>;
            case 'Critical':
                return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>;
            default:
                return <Badge variant="secondary">{status}</Badge>;
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
                {/* Asset Category Distribution */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Package className="h-4 w-4 text-primary" />
                            Assets by Category
                        </CardTitle>
                        <CardDescription>Distribution by type</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={categoryDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={isMobile ? 40 : 50}
                                        outerRadius={isMobile ? 65 : 80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={renderPieLabel}
                                        labelLine={!isMobile}
                                    >
                                        {categoryDistribution.map((entry, index) => (
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

                {/* Assets per Building */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-blue-500" />
                            Assets per Building
                        </CardTitle>
                        <CardDescription>Registered asset count</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={assetsByBuilding.slice(0, 8)} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                    <XAxis type="number" />
                                    <YAxis 
                                        dataKey="name" 
                                        type="category" 
                                        width={isMobile ? 60 : 100}
                                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }}
                                    />
                                    <Tooltip 
                                        contentStyle={{ 
                                            backgroundColor: 'hsl(var(--popover))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '8px'
                                        }}
                                        formatter={(value: number, name: string, props: any) => [
                                            `${value} assets`,
                                            props.payload.fullName
                                        ]}
                                    />
                                    <Bar 
                                        dataKey="assetCount" 
                                        name="Assets"
                                        fill="hsl(var(--primary))"
                                        radius={[0, 4, 4, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Building Asset Table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-primary" />
                        Asset Overview per Building
                    </CardTitle>
                    <CardDescription>Status and valuation</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Building</TableHead>
                                    <TableHead className="text-right">Count</TableHead>
                                    <TableHead className="text-right">Avg. Age</TableHead>
                                    <TableHead className="text-right">Value</TableHead>
                                    <TableHead className="text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {assetsByBuilding.map((building) => (
                                    <TableRow key={building.fmGuid}>
                                        <TableCell className="font-medium">{building.fullName}</TableCell>
                                        <TableCell className="text-right">{building.assetCount}</TableCell>
                                        <TableCell className="text-right">{building.avgAge} years</TableCell>
                                        <TableCell className="text-right">
                                            {(building.replacementValue / 1000).toFixed(0)} kSEK
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {getStatusBadge(building.maintenanceStatus)}
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
