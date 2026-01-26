import React, { useContext, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
    Wrench, AlertTriangle, CheckCircle2, Clock, 
    Building2, TrendingUp, Calendar, FileText
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

export default function FacilityManagementTab() {
    const { navigatorTreeData } = useContext(AppContext);

    // Generate mock FM data per building
    const fmData = useMemo(() => {
        return navigatorTreeData.map((building) => {
            const hash = hashString(building.fmGuid || '');
            return {
                fmGuid: building.fmGuid,
                name: building.commonName || building.name || 'Byggnad',
                activeIssues: 2 + (hash % 8),
                plannedMaintenance: 1 + (hash % 5),
                completedThisMonth: 5 + (hash % 12),
                slaCompliance: 85 + (hash % 15),
                monthlyCost: 15000 + (hash % 35000),
            };
        });
    }, [navigatorTreeData]);

    // KPI totals
    const totals = useMemo(() => {
        return {
            totalIssues: fmData.reduce((sum, b) => sum + b.activeIssues, 0),
            totalPlanned: fmData.reduce((sum, b) => sum + b.plannedMaintenance, 0),
            totalCompleted: fmData.reduce((sum, b) => sum + b.completedThisMonth, 0),
            avgSla: Math.round(fmData.reduce((sum, b) => sum + b.slaCompliance, 0) / fmData.length),
            totalCost: fmData.reduce((sum, b) => sum + b.monthlyCost, 0),
        };
    }, [fmData]);

    // Issue type distribution
    const issueTypes = [
        { name: 'VVS', value: 35, color: 'hsl(220, 80%, 55%)' },
        { name: 'El', value: 25, color: 'hsl(48, 96%, 53%)' },
        { name: 'Hiss', value: 15, color: 'hsl(var(--destructive))' },
        { name: 'Lås/Dörr', value: 15, color: 'hsl(262, 83%, 58%)' },
        { name: 'Övrigt', value: 10, color: 'hsl(var(--muted-foreground))' },
    ];

    const kpiCards = [
        { 
            title: 'Aktiva ärenden', 
            value: totals.totalIssues, 
            icon: AlertTriangle, 
            color: 'text-yellow-500',
            badge: 'Pågående'
        },
        { 
            title: 'Planerat underhåll', 
            value: totals.totalPlanned, 
            icon: Calendar, 
            color: 'text-blue-500',
            badge: 'Denna vecka'
        },
        { 
            title: 'Avslutade (månad)', 
            value: totals.totalCompleted, 
            icon: CheckCircle2, 
            color: 'text-green-500',
            badge: '+12%'
        },
        { 
            title: 'SLA-efterlevnad', 
            value: `${totals.avgSla}%`, 
            icon: TrendingUp, 
            color: 'text-primary',
            badge: 'Snitt'
        },
    ];

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {kpiCards.map((kpi, index) => (
                    <Card key={index}>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-2">
                                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                                <Badge variant="secondary" className="text-xs">
                                    {kpi.badge}
                                </Badge>
                            </div>
                            <p className="text-2xl font-bold">{kpi.value}</p>
                            <p className="text-xs text-muted-foreground">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Issues per Building */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Wrench className="h-4 w-4 text-primary" />
                            Ärenden per byggnad
                        </CardTitle>
                        <CardDescription>Aktiva serviceärenden</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={fmData.slice(0, 8)} layout="vertical">
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
                                        dataKey="activeIssues" 
                                        name="Ärenden"
                                        fill="hsl(var(--primary))"
                                        radius={[0, 4, 4, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Issue Type Distribution */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <FileText className="h-4 w-4 text-orange-500" />
                            Ärendetyper
                        </CardTitle>
                        <CardDescription>Fördelning per kategori</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={issueTypes}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        labelLine={false}
                                    >
                                        {issueTypes.map((entry, index) => (
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

            {/* Building Table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        Fastighetsöversikt
                    </CardTitle>
                    <CardDescription>FM-status per byggnad</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Byggnad</TableHead>
                                    <TableHead className="text-right">Aktiva</TableHead>
                                    <TableHead className="text-right">Planerat</TableHead>
                                    <TableHead className="text-right">Avslutade</TableHead>
                                    <TableHead className="text-right">SLA %</TableHead>
                                    <TableHead className="text-right">Kostnad/mån</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {fmData.slice(0, 10).map((building) => (
                                    <TableRow key={building.fmGuid}>
                                        <TableCell className="font-medium">{building.name}</TableCell>
                                        <TableCell className="text-right">
                                            <Badge variant={building.activeIssues > 5 ? "destructive" : "secondary"}>
                                                {building.activeIssues}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">{building.plannedMaintenance}</TableCell>
                                        <TableCell className="text-right">{building.completedThisMonth}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={building.slaCompliance >= 90 ? 'text-green-500' : 'text-yellow-500'}>
                                                {building.slaCompliance}%
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {building.monthlyCost.toLocaleString('sv-SE')} kr
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
