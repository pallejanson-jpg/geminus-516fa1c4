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

// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

export default function AssetManagementTab() {
    const { navigatorTreeData, allData } = useContext(AppContext);

    // Count assets from allData
    const assetStats = useMemo(() => {
        const assets = allData.filter(item => 
            item.category !== 'Building' && 
            item.category !== 'Building Storey' && 
            item.category !== 'Space'
        );
        
        const categories: Record<string, number> = {};
        assets.forEach(asset => {
            const cat = asset.assetType || asset.category || 'Okänd';
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
            return {
                fmGuid: building.fmGuid,
                name: building.commonName || building.name || 'Byggnad',
                assetCount: 20 + (hash % 80),
                avgAge: 3 + (hash % 12),
                replacementValue: 500000 + (hash % 2000000),
                maintenanceStatus: hash % 100 > 70 ? 'Kritisk' : hash % 100 > 40 ? 'Planerad' : 'OK',
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
        { name: 'El/Belysning', value: 22, color: 'hsl(48, 96%, 53%)' },
        { name: 'Hissar', value: 8, color: 'hsl(var(--primary))' },
        { name: 'Säkerhet', value: 15, color: 'hsl(var(--destructive))' },
        { name: 'VVS', value: 18, color: 'hsl(142, 71%, 45%)' },
        { name: 'Övrigt', value: 9, color: 'hsl(var(--muted-foreground))' },
    ];

    // Maintenance status distribution
    const maintenanceDistribution = useMemo(() => {
        const ok = assetsByBuilding.filter(b => b.maintenanceStatus === 'OK').length;
        const planned = assetsByBuilding.filter(b => b.maintenanceStatus === 'Planerad').length;
        const critical = assetsByBuilding.filter(b => b.maintenanceStatus === 'Kritisk').length;
        return [
            { name: 'OK', value: ok, color: 'hsl(142, 71%, 45%)' },
            { name: 'Planerad', value: planned, color: 'hsl(48, 96%, 53%)' },
            { name: 'Kritisk', value: critical, color: 'hsl(var(--destructive))' },
        ];
    }, [assetsByBuilding]);

    const kpiCards = [
        { 
            title: 'Totalt antal tillgångar', 
            value: totals.totalAssets.toLocaleString('sv-SE'), 
            icon: Package, 
            color: 'text-primary'
        },
        { 
            title: 'Genomsnittsålder (år)', 
            value: totals.avgAge, 
            icon: Clock, 
            color: 'text-blue-500'
        },
        { 
            title: 'Återanskaffningsvärde', 
            value: `${(totals.totalValue / 1000000).toFixed(1)} MSEK`, 
            icon: CircleDollarSign, 
            color: 'text-green-500'
        },
        { 
            title: 'Kräver underhåll', 
            value: totals.needsMaintenance, 
            icon: Wrench, 
            color: 'text-yellow-500'
        },
    ];

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'OK':
                return <Badge className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>;
            case 'Planerad':
                return <Badge className="bg-yellow-600"><Clock className="h-3 w-3 mr-1" />Planerad</Badge>;
            case 'Kritisk':
                return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Kritisk</Badge>;
            default:
                return <Badge variant="secondary">{status}</Badge>;
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
                {/* Asset Category Distribution */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Package className="h-4 w-4 text-primary" />
                            Tillgångar per kategori
                        </CardTitle>
                        <CardDescription>Fördelning per typ</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={categoryDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        labelLine={false}
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
                            Tillgångar per byggnad
                        </CardTitle>
                        <CardDescription>Antal registrerade tillgångar</CardDescription>
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
                                        width={100}
                                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                                    />
                                    <Tooltip 
                                        contentStyle={{ 
                                            backgroundColor: 'hsl(var(--popover))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: '8px'
                                        }}
                                    />
                                    <Bar 
                                        dataKey="assetCount" 
                                        name="Tillgångar"
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
                        Tillgångsöversikt per byggnad
                    </CardTitle>
                    <CardDescription>Status och värdering</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Byggnad</TableHead>
                                    <TableHead className="text-right">Antal</TableHead>
                                    <TableHead className="text-right">Snittålder</TableHead>
                                    <TableHead className="text-right">Värde</TableHead>
                                    <TableHead className="text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {assetsByBuilding.map((building) => (
                                    <TableRow key={building.fmGuid}>
                                        <TableCell className="font-medium">{building.name}</TableCell>
                                        <TableCell className="text-right">{building.assetCount}</TableCell>
                                        <TableCell className="text-right">{building.avgAge} år</TableCell>
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
