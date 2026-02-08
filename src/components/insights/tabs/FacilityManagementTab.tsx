import React, { useContext, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
    Wrench, AlertTriangle, CheckCircle2, Clock, 
    Building2, TrendingUp, Calendar, FileText, List, ChevronRight
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/use-mobile';

// Mockup indicator badge
const MockBadge = () => (
    <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30 ml-1">
        Demo
    </Badge>
);

// Helper for deterministic pseudo-random based on string
const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

// Truncate name for chart display
const truncateName = (name: string, maxLen = 12) => 
    name.length > maxLen ? name.substring(0, maxLen) + '...' : name;

// Work order status types
type WorkOrderStatus = 'open' | 'in_progress' | 'pending' | 'completed' | 'cancelled';

interface MockWorkOrder {
    id: string;
    title: string;
    status: WorkOrderStatus;
    priority: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    buildingName: string;
    buildingFmGuid: string;
    reportedAt: string;
    dueDate: string | null;
    assignedTo: string;
}

// Generate mock work orders for demo
const generateMockWorkOrders = (buildings: any[]): MockWorkOrder[] => {
    const categories = ['HVAC', 'Electrical', 'Elevator', 'Doors/Locks', 'Ventilation', 'Cleaning', 'Other'];
    const statuses: WorkOrderStatus[] = ['open', 'in_progress', 'pending', 'completed', 'cancelled'];
    const priorities: MockWorkOrder['priority'][] = ['low', 'medium', 'high', 'critical'];
    const assignees = ['Johan A.', 'Maria B.', 'Erik C.', 'Anna D.', 'Olof E.'];
    const titles = [
        'Roof leak', 'Broken door', 'Elevator malfunction', 'Heating issue',
        'Lights out', 'Ventilation noise', 'Lock problem', 'Faucet leak',
        'Floor wear', 'Moisture damage', 'Window broken', 'Electrical fault', 'AC not working'
    ];

    const orders: MockWorkOrder[] = [];
    
    buildings.forEach(building => {
        const hash = hashString(building.fmGuid || building.name || '');
        const orderCount = 2 + (hash % 6);
        
        for (let i = 0; i < orderCount; i++) {
            const seed = hash + i * 17;
            const daysAgo = seed % 30;
            const reportedDate = new Date();
            reportedDate.setDate(reportedDate.getDate() - daysAgo);
            
            const dueDate = new Date(reportedDate);
            dueDate.setDate(dueDate.getDate() + 7 + (seed % 14));
            
            orders.push({
                id: `WO-${1000 + orders.length}`,
                title: titles[seed % titles.length],
                status: statuses[seed % statuses.length],
                priority: priorities[(seed + i) % priorities.length],
                category: categories[seed % categories.length],
                buildingName: building.commonName || building.name || 'Unknown building',
                buildingFmGuid: building.fmGuid,
                reportedAt: reportedDate.toISOString().split('T')[0],
                dueDate: dueDate.toISOString().split('T')[0],
                assignedTo: assignees[seed % assignees.length],
            });
        }
    });
    
    return orders;
};

// Status colors and labels
const statusConfig: Record<WorkOrderStatus, { label: string; color: string; bgClass: string }> = {
    open: { label: 'Open', color: 'text-blue-600', bgClass: 'bg-blue-100 dark:bg-blue-900/30' },
    in_progress: { label: 'In Progress', color: 'text-amber-600', bgClass: 'bg-amber-100 dark:bg-amber-900/30' },
    pending: { label: 'Pending', color: 'text-purple-600', bgClass: 'bg-purple-100 dark:bg-purple-900/30' },
    completed: { label: 'Completed', color: 'text-green-600', bgClass: 'bg-green-100 dark:bg-green-900/30' },
    cancelled: { label: 'Cancelled', color: 'text-gray-500', bgClass: 'bg-gray-100 dark:bg-gray-800' },
};

const priorityConfig: Record<MockWorkOrder['priority'], { label: string; color: string }> = {
    low: { label: 'Low', color: 'text-gray-500' },
    medium: { label: 'Medium', color: 'text-blue-500' },
    high: { label: 'High', color: 'text-orange-500' },
    critical: { label: 'Critical', color: 'text-red-500' },
};

export default function FacilityManagementTab() {
    const { navigatorTreeData } = useContext(AppContext);
    const isMobile = useIsMobile();
    const [showWorkOrderList, setShowWorkOrderList] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | 'all'>('all');

    // Generate mock work orders
    const workOrders = useMemo(() => {
        return generateMockWorkOrders(navigatorTreeData);
    }, [navigatorTreeData]);

    // Work order status distribution for bar chart
    const statusData = useMemo(() => {
        const counts: Record<WorkOrderStatus, number> = {
            open: 0,
            in_progress: 0,
            pending: 0,
            completed: 0,
            cancelled: 0,
        };
        workOrders.forEach(wo => counts[wo.status]++);
        
        return [
            { name: 'Open', value: counts.open, fill: 'hsl(220, 80%, 55%)' },
            { name: 'In Progress', value: counts.in_progress, fill: 'hsl(38, 92%, 50%)' },
            { name: 'Pending', value: counts.pending, fill: 'hsl(262, 83%, 58%)' },
            { name: 'Completed', value: counts.completed, fill: 'hsl(142, 71%, 45%)' },
            { name: 'Cancelled', value: counts.cancelled, fill: 'hsl(var(--muted-foreground))' },
        ];
    }, [workOrders]);

    // Generate mock FM data per building (legacy)
    const fmData = useMemo(() => {
        return navigatorTreeData.map((building) => {
            const hash = hashString(building.fmGuid || '');
            const buildingOrders = workOrders.filter(wo => wo.buildingFmGuid === building.fmGuid);
            const fullName = building.commonName || building.name || 'Building';
            return {
                fmGuid: building.fmGuid,
                name: truncateName(fullName),
                fullName,
                activeIssues: buildingOrders.filter(wo => wo.status === 'open' || wo.status === 'in_progress').length,
                plannedMaintenance: 1 + (hash % 5),
                completedThisMonth: buildingOrders.filter(wo => wo.status === 'completed').length,
                slaCompliance: 85 + (hash % 15),
                monthlyCost: 15000 + (hash % 35000),
            };
        });
    }, [navigatorTreeData, workOrders]);

    // KPI totals
    const totals = useMemo(() => {
        const activeOrders = workOrders.filter(wo => wo.status === 'open' || wo.status === 'in_progress');
        const completedOrders = workOrders.filter(wo => wo.status === 'completed');
        const pendingOrders = workOrders.filter(wo => wo.status === 'pending');
        
        return {
            totalActive: activeOrders.length,
            totalPending: pendingOrders.length,
            totalCompleted: completedOrders.length,
            avgSla: Math.round(fmData.reduce((sum, b) => sum + b.slaCompliance, 0) / Math.max(fmData.length, 1)),
            totalCost: fmData.reduce((sum, b) => sum + b.monthlyCost, 0),
        };
    }, [workOrders, fmData]);

    // Issue type distribution
    const categoryData = useMemo(() => {
        const counts: Record<string, number> = {};
        workOrders.forEach(wo => {
            counts[wo.category] = (counts[wo.category] || 0) + 1;
        });
        
        const colors = [
            'hsl(220, 80%, 55%)',
            'hsl(48, 96%, 53%)',
            'hsl(var(--destructive))',
            'hsl(262, 83%, 58%)',
            'hsl(142, 71%, 45%)',
            'hsl(38, 92%, 50%)',
            'hsl(var(--muted-foreground))',
        ];
        
        return Object.entries(counts)
            .map(([name, value], idx) => ({
                name,
                value,
                color: colors[idx % colors.length],
            }))
            .sort((a, b) => b.value - a.value);
    }, [workOrders]);

    // Filtered work orders for the list dialog
    const filteredWorkOrders = useMemo(() => {
        return workOrders.filter(wo => {
            const matchesSearch = searchQuery === '' || 
                wo.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                wo.buildingName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                wo.id.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = statusFilter === 'all' || wo.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [workOrders, searchQuery, statusFilter]);

    const kpiCards = [
        { 
            title: 'Active Issues', 
            value: totals.totalActive, 
            icon: AlertTriangle, 
            color: 'text-yellow-500',
            badge: 'Open + In Progress'
        },
        { 
            title: 'Pending', 
            value: totals.totalPending, 
            icon: Clock, 
            color: 'text-purple-500',
            badge: 'Awaiting'
        },
        { 
            title: 'Completed (month)', 
            value: totals.totalCompleted, 
            icon: CheckCircle2, 
            color: 'text-green-500',
            badge: 'This period'
        },
        { 
            title: 'SLA Compliance', 
            value: `${totals.avgSla}%`, 
            icon: TrendingUp, 
            color: 'text-primary',
            badge: 'Average'
        },
    ];

    // Mobile-friendly pie chart label
    const renderPieLabel = isMobile 
        ? undefined 
        : ({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`;

    return (
        <div className="space-y-6">
            {/* All data is MOCK */}
            <div className="flex items-center gap-2 mb-2">
                <MockBadge />
                <span className="text-xs text-purple-400">All FM data is demo data</span>
            </div>

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
                            <p className="text-2xl font-bold text-purple-400">{kpi.value}</p>
                            <p className="text-xs text-muted-foreground">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Work Order Status Chart - clickable to open list */}
            <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setShowWorkOrderList(true)}>
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Wrench className="h-4 w-4 text-orange-500" />
                                Work Order Status
                            </CardTitle>
                            <CardDescription>Distribution by status - click for details</CardDescription>
                        </div>
                        <Button variant="ghost" size="sm" className="gap-1">
                            <List className="h-4 w-4" />
                            View List
                            <ChevronRight className="h-3 w-3" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={statusData} layout="horizontal">
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                <XAxis 
                                    dataKey="name" 
                                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }}
                                />
                                <YAxis />
                                <Tooltip 
                                    contentStyle={{ 
                                        backgroundColor: 'hsl(var(--popover))',
                                        border: '1px solid hsl(var(--border))',
                                        borderRadius: '8px'
                                    }}
                                />
                                <Bar 
                                    dataKey="value" 
                                    name="Count"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Charts Row */}
            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Issues per Building */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary" />
                            Issues per Building
                        </CardTitle>
                        <CardDescription>Active service issues</CardDescription>
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
                                            `${value} issues`,
                                            props.payload.fullName
                                        ]}
                                    />
                                    <Bar 
                                        dataKey="activeIssues" 
                                        name="Issues"
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
                            Issue Categories
                        </CardTitle>
                        <CardDescription>Distribution by category</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={categoryData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={isMobile ? 40 : 50}
                                        outerRadius={isMobile ? 65 : 80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={renderPieLabel}
                                        labelLine={!isMobile}
                                    >
                                        {categoryData.map((entry, index) => (
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
                        Property Overview
                    </CardTitle>
                    <CardDescription>FM status per building</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Building</TableHead>
                                    <TableHead className="text-right">Active</TableHead>
                                    <TableHead className="text-right">Planned</TableHead>
                                    <TableHead className="text-right">Completed</TableHead>
                                    <TableHead className="text-right">SLA %</TableHead>
                                    <TableHead className="text-right">Cost/month</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {fmData.slice(0, 10).map((building) => (
                                    <TableRow key={building.fmGuid}>
                                        <TableCell className="font-medium">{building.fullName}</TableCell>
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
                                            {building.monthlyCost.toLocaleString()} SEK
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Work Order List Dialog */}
            <Dialog open={showWorkOrderList} onOpenChange={setShowWorkOrderList}>
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Wrench className="h-5 w-5 text-orange-500" />
                            Work Order List
                        </DialogTitle>
                        <DialogDescription>
                            {workOrders.length} work orders total
                        </DialogDescription>
                    </DialogHeader>
                    
                    {/* Filters */}
                    <div className="flex flex-wrap gap-2 py-2">
                        <Input
                            placeholder="Search issues..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-48 h-9"
                        />
                        <div className="flex gap-1 flex-wrap">
                            <Button
                                variant={statusFilter === 'all' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('all')}
                            >
                                All
                            </Button>
                            <Button
                                variant={statusFilter === 'open' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('open')}
                            >
                                Open
                            </Button>
                            <Button
                                variant={statusFilter === 'in_progress' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('in_progress')}
                            >
                                In Progress
                            </Button>
                            <Button
                                variant={statusFilter === 'completed' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setStatusFilter('completed')}
                            >
                                Completed
                            </Button>
                        </div>
                    </div>

                    {/* Table */}
                    <ScrollArea className="flex-1">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-24">ID</TableHead>
                                    <TableHead>Issue</TableHead>
                                    <TableHead>Building</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Priority</TableHead>
                                    <TableHead>Assigned</TableHead>
                                    <TableHead>Due</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredWorkOrders.map((wo) => (
                                    <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50">
                                        <TableCell className="font-mono text-xs">{wo.id}</TableCell>
                                        <TableCell className="font-medium">{wo.title}</TableCell>
                                        <TableCell className="text-sm">{wo.buildingName}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="text-xs">
                                                {wo.category}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusConfig[wo.status].bgClass} ${statusConfig[wo.status].color}`}>
                                                {statusConfig[wo.status].label}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className={`text-xs font-medium ${priorityConfig[wo.priority].color}`}>
                                                {priorityConfig[wo.priority].label}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-sm">{wo.assignedTo}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{wo.dueDate}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {filteredWorkOrders.length === 0 && (
                            <div className="flex items-center justify-center py-12 text-muted-foreground">
                                No work orders match the filters
                            </div>
                        )}
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    );
}
