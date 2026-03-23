import React, { useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { extractSpaceArea } from '@/lib/building-utils';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useXktPreload } from '@/hooks/useXktPreload';
import { hslStringToRgbFloat, getVisualizationColor, rgbToHex, generateMockSensorData, VISUALIZATION_CONFIGS, VisualizationType } from '@/lib/visualization-utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { 
    Building2, Zap, TrendingDown, TrendingUp, Leaf, 
    ThermometerSun, Droplets, Gauge, ArrowLeft, Layers, DoorOpen, Package, Eye, Maximize2, Expand, Shrink,
    Loader2, Thermometer, Wind, Users, Wifi, WifiOff, Bell, Trash2, MapPin, Boxes, Search, X, BarChart2
} from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import AlarmManagementTab from '@/components/insights/tabs/AlarmManagementTab';
import PredictiveMaintenanceTab from '@/components/insights/tabs/PredictiveMaintenanceTab';
import RoomOptimizationTab from '@/components/insights/tabs/RoomOptimizationTab';
import RagSearchTab from '@/components/insights/tabs/RagSearchTab';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
const NativeXeokitViewer = React.lazy(() => import('@/components/viewer/NativeXeokitViewer'));
import { useSenslincBuildingData } from '@/hooks/useSenslincData';
import { cn } from '@/lib/utils';
import RoomSensorDetailSheet from '@/components/insights/RoomSensorDetailSheet';
import { INSIGHTS_COLOR_UPDATE_EVENT, ALARM_ANNOTATIONS_SHOW_EVENT, INSIGHTS_COLOR_RESET_EVENT } from '@/lib/viewer-events';
import { FORCE_SHOW_SPACES_EVENT } from '@/components/viewer/RoomVisualizationPanel';
import { FLOOR_SELECTION_CHANGED_EVENT, type FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { toast } from 'sonner';


const HIERARCHY_CATEGORIES = ['Building', 'Building Storey', 'Space', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace'];

// Floor colors — derived from Nordic Pro chart palette
const FLOOR_COLORS = [
  'hsl(var(--chart-2))',  // Blue
  'hsl(var(--chart-3))',  // Teal
  'hsl(var(--chart-4))',  // Amber
  'hsl(var(--chart-1))',  // Purple
  'hsl(var(--chart-5))',  // Rose
  'hsl(var(--chart-7))',  // Lavender
  'hsl(var(--chart-6))',  // Blue-grey
  'hsl(var(--chart-8))',  // Green
];

interface BuildingInsightsViewProps {
    facility: Facility;
    onBack: () => void;
    /** When true, hides the page header (back button + title) — used in drawer/panel context */
    drawerMode?: boolean;
}



// Reusable viewer link icon — always visible, signals "tap to view visually"
const ViewerLink = () => {
    const [pulse, setPulse] = React.useState(true);
    React.useEffect(() => {
        const timer = setTimeout(() => setPulse(false), 3000);
        return () => clearTimeout(timer);
    }, []);
    return (
        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium shadow-md shrink-0 ${pulse ? 'ring-2 ring-primary/50 animate-pulse' : ''}`}>
            <Eye className="h-3.5 w-3.5" />
            <span>View</span>
        </div>
    );
};

// Energy distribution (building-specific mock) — uses chart theme
const energyDistribution = [
    { name: 'Heating', value: 42, color: 'hsl(var(--destructive))' },
    { name: 'Cooling', value: 22, color: 'hsl(var(--chart-2))' },
    { name: 'Lighting', value: 20, color: 'hsl(var(--chart-4))' },
    { name: 'Equipment', value: 12, color: 'hsl(var(--chart-7))' },
    { name: 'Other', value: 4, color: 'hsl(var(--muted-foreground))' },
];

// Monthly trend (building-specific mock)
const monthlyTrend = [
    { month: 'Jan', consumption: 48, target: 42 },
    { month: 'Feb', consumption: 45, target: 41 },
    { month: 'Mar', consumption: 40, target: 40 },
    { month: 'Apr', consumption: 32, target: 37 },
    { month: 'May', consumption: 28, target: 33 },
    { month: 'Jun', consumption: 24, target: 30 },
    { month: 'Jul', consumption: 26, target: 29 },
    { month: 'Aug', consumption: 27, target: 30 },
    { month: 'Sep', consumption: 31, target: 33 },
    { month: 'Oct', consumption: 36, target: 37 },
    { month: 'Nov', consumption: 43, target: 40 },
    { month: 'Dec', consumption: 47, target: 43 },
];

const hashString = (str: string) => {
    return str.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
};

// ─── Inline 3D Viewer for desktop ───
interface InsightsInlineViewerProps {
    fmGuid: string;
    insightsColorMode?: string;
    insightsColorMap?: Record<string, [number, number, number]>;
    onFullscreen: () => void;
    expanded: boolean;
    onToggleExpand: () => void;
}

const InsightsInlineViewer: React.FC<InsightsInlineViewerProps> = ({ fmGuid, insightsColorMode, insightsColorMap, onFullscreen, expanded, onToggleExpand }) => {
    return (
        <div className={`${expanded ? 'w-[700px] h-[700px]' : 'w-[400px] h-[500px]'} shrink-0 sticky top-2 rounded-lg border border-border overflow-hidden relative group transition-all duration-300`} style={{ background: 'linear-gradient(180deg, rgb(255,255,255) 0%, rgb(230,230,230) 100%)' }}>
            {/* Always mount the 3D viewer so it loads in the background */}
            <div className="absolute inset-0">
                <React.Suspense fallback={
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                }>
                    <NativeXeokitViewer
                        buildingFmGuid={fmGuid}
                    />
                </React.Suspense>
            </div>
            {/* Toolbar buttons overlay */}
            <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 bg-background/80 backdrop-blur-sm border border-border shadow-lg"
                    onClick={onToggleExpand}
                    title={expanded ? 'Shrink' : 'Expand'}
                >
                    {expanded ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
                </Button>
                <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 bg-background/80 backdrop-blur-sm border border-border shadow-lg"
                    onClick={onFullscreen}
                    title="View in fullscreen"
                >
                    <Maximize2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
};

export default function BuildingInsightsView({ facility, onBack, drawerMode }: BuildingInsightsViewProps) {
    const { allData } = useContext(AppContext);
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    
    // Preload XKT models in background so 3D viewer loads fast
    useXktPreload(facility.fmGuid);

    // Desktop inline viewer state
    const [inlineInsightsMode, setInlineInsightsMode] = useState<string | undefined>(undefined);
    const [inlineColorMap, setInlineColorMap] = useState<Record<string, [number, number, number]> | undefined>(undefined);
    const [inlineExpanded, setInlineExpanded] = useState(false);

    // Sensors tab state
    const [sensorMetric, setSensorMetric] = useState<VisualizationType>('temperature');
    const [selectedSensorRooms, setSelectedSensorRooms] = useState<Set<string>>(new Set());
    const [sensorSheetOpen, setSensorSheetOpen] = useState(false);
    const [sensorSheetRoom, setSensorSheetRoom] = useState<{ fmGuid: string; name: string } | null>(null);
    const { data: buildingIoT, isLoading: iotLoading, isLive: iotLive } = useSenslincBuildingData(facility.fmGuid);

    // FM-flik state (was "Larm")
    const [alarmCount, setAlarmCount] = useState<number>(0);
    const [alarmsByLevel, setAlarmsByLevel] = useState<{ levelGuid: string; levelName: string; count: number }[]>([]);
    const [alarmList, setAlarmList] = useState<any[]>([]);
    const [alarmRefreshKey, setAlarmRefreshKey] = useState(0);
    const [showAlarmManagement, setShowAlarmManagement] = useState(false);

    // Space tab floor filter + room type filter
    const [spaceFloorFilter, setSpaceFloorFilter] = useState<string>('');
    const [selectedRoomType, setSelectedRoomType] = useState<string>('');
    const [assetFloorFilter, setAssetFloorFilter] = useState<string>('');
    // FM grid search + level filter
    const [alarmSearch, setAlarmSearch] = useState('');
    const [alarmLevelFilter, setAlarmLevelFilter] = useState<string>('');
    // Controlled tabs
    const [activeTab, setActiveTab] = useState('performance');

    // Reset 3D colorization when switching tabs (dispatch reset event, no full model reload)
    useEffect(() => {
        window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_RESET_EVENT));
        // Also reset inline viewer state
        setInlineInsightsMode(undefined);
        setInlineColorMap(undefined);
    }, [activeTab]);

    // Room metadata lookup from allData (for enriching alarm list)
    const roomLookup = useMemo(() => {
        const map = new Map<string, { name: string; commonName: string }>();
        allData.forEach((a: any) => {
            if (a.buildingFmGuid !== facility.fmGuid) return;
            if (a.category !== 'Space' && a.category !== 'IfcSpace') return;
            map.set(a.fmGuid?.toLowerCase(), { name: a.name || '', commonName: a.commonName || '' });
        });
        return map;
    }, [allData, facility.fmGuid]);

    // Level name lookup — defined after buildingStoreys below, use lazy initializer
    const levelNamesRef = React.useRef(new Map<string, string>());

    const fetchAlarmData = useCallback(async () => {
        try {
            // Count
            const { count } = await supabase
                .from('assets')
                .select('*', { count: 'exact', head: true })
                .eq('building_fm_guid', facility.fmGuid)
                .eq('asset_type', 'IfcAlarm');
            setAlarmCount(count || 0);

            // Per-level aggregation
            const { data: levelAssets } = await supabase
                .from('assets')
                .select('fm_guid, name, common_name')
                .eq('building_fm_guid', facility.fmGuid)
                .in('category', ['Building Storey', 'IfcBuildingStorey'])
                .limit(50);

            const levelMap = new Map<string, string>();
            let unkIdx = 1;
            (levelAssets || []).forEach((l: any) => {
                levelMap.set(l.fm_guid, l.common_name || l.name || `Floor (unknown ${unkIdx++})`);
            });

            const { data: alarmLevels } = await supabase
                .from('assets')
                .select('level_fm_guid')
                .eq('building_fm_guid', facility.fmGuid)
                .eq('asset_type', 'IfcAlarm')
                .limit(5000);

            if (alarmLevels) {
                const lvlCounts: Record<string, number> = {};
                alarmLevels.forEach((a: any) => {
                    const guid = a.level_fm_guid || '__none__';
                    lvlCounts[guid] = (lvlCounts[guid] || 0) + 1;
                });
                const mapped = Object.entries(lvlCounts)
                    .map(([g, cnt]) => ({
                        levelGuid: g,
                        levelName: g === '__none__' ? 'Unknown' : (levelMap.get(g) || 'Floor (unknown)'),
                        count: cnt,
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 8);
                setAlarmsByLevel(mapped);
            }

            // Recent list — include coordinates for "Visa i 3D"
            const { data: recent } = await supabase
                .from('assets')
                .select('id, fm_guid, level_fm_guid, in_room_fm_guid, updated_at, coordinate_x, coordinate_y, coordinate_z, name, common_name, attributes')
                .eq('building_fm_guid', facility.fmGuid)
                .eq('asset_type', 'IfcAlarm')
                .order('updated_at', { ascending: false })
                .limit(50);
            setAlarmList(recent || []);
        } catch (e) {
            console.error('Error fetching alarm data:', e);
        }
    }, [facility.fmGuid, alarmRefreshKey]);

    useEffect(() => { fetchAlarmData(); }, [fetchAlarmData]);

    // Query database for real asset count for this building
    const [dbAssetCount, setDbAssetCount] = useState<number>(0);
    const [dbAssetCategories, setDbAssetCategories] = useState<Record<string, number>>({});

    useEffect(() => {
        const fetchBuildingAssets = async () => {
            try {
                const { count } = await supabase
                    .from('assets')
                    .select('*', { count: 'exact', head: true })
                    .eq('building_fm_guid', facility.fmGuid)
                    .not('category', 'in', `(${HIERARCHY_CATEGORIES.join(',')})`);
                setDbAssetCount(count || 0);

                const { data: catData } = await supabase
                    .from('assets')
                    .select('asset_type')
                    .eq('building_fm_guid', facility.fmGuid)
                    .not('category', 'in', `(${HIERARCHY_CATEGORIES.join(',')})`)
                    .limit(5000);
                if (catData) {
                    const cats: Record<string, number> = {};
                    catData.forEach((row: any) => {
                        const cat = (row.asset_type || 'Unknown').replace('Ifc', '');
                        cats[cat] = (cats[cat] || 0) + 1;
                    });
                    setDbAssetCategories(cats);
                }
            } catch (e) {
                console.error('Failed to fetch building asset counts:', e);
            }
        };
        fetchBuildingAssets();
    }, [facility.fmGuid]);

    // Filter building-specific data once (stable ref unless building changes)
    const buildingSpaces = useMemo(() => allData.filter(
        (a: any) => (a.category === 'Space' || a.category === 'IfcSpace') && a.buildingFmGuid === facility.fmGuid
    ), [allData, facility.fmGuid]);

    const buildingStoreys = useMemo(() => allData.filter(
        (a: any) => (a.category === 'Building Storey' || a.category === 'IfcBuildingStorey') && a.buildingFmGuid === facility.fmGuid
    ), [allData, facility.fmGuid]);

    // Level name lookup (needs buildingStoreys)
    const levelNames = useMemo(() => {
        const map = new Map<string, string>();
        let unknownIndex = 1;
        buildingStoreys.forEach((s: any) => {
            const name = s.commonName || s.name;
            map.set(s.fmGuid?.toLowerCase(), name || `Floor (unknown ${unknownIndex++})`);
        });
        levelNamesRef.current = map;
        return map;
    }, [buildingStoreys]);

    const SENSOR_METRICS = [
        { key: 'temperature' as VisualizationType, label: 'Temp', unit: '°C', icon: Thermometer, color: 'hsl(var(--chart-3))' },
        { key: 'co2' as VisualizationType, label: 'CO₂', unit: 'ppm', icon: Wind, color: 'hsl(var(--chart-2))' },
        { key: 'humidity' as VisualizationType, label: 'Humidity', unit: '%', icon: Droplets, color: 'hsl(var(--chart-7))' },
        { key: 'occupancy' as VisualizationType, label: 'Occupancy', unit: '%', icon: Users, color: 'hsl(var(--chart-5))' },
    ] as const;

    // Deduplicated floor list for Space tab filter
    const spaceFloorOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: { guid: string; name: string }[] = [];
        buildingStoreys.forEach((s: any) => {
            const baseName = (s.commonName || '').replace(/\s*-\s*\d+$/, '');
            if (!baseName || seen.has(baseName)) return;
            seen.add(baseName);
            options.push({ guid: s.fmGuid, name: baseName });
        });
        return options;
    }, [buildingStoreys]);

    // Spaces filtered by floor
    const floorFilteredSpaces = useMemo(() => {
        if (!spaceFloorFilter) return buildingSpaces;
        const matchingGuids = new Set<string>();
        buildingStoreys.forEach((s: any) => {
            const baseName = (s.commonName || '').replace(/\s*-\s*\d+$/, '');
            if (baseName === spaceFloorFilter) matchingGuids.add(s.fmGuid?.toLowerCase());
        });
        return buildingSpaces.filter((s: any) => matchingGuids.has(s.levelFmGuid?.toLowerCase()));
    }, [buildingSpaces, buildingStoreys, spaceFloorFilter]);

    // Space type pie — respects floor filter
    const spaceTypePie = useMemo(() => {
        const colors = [
            'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
            'hsl(var(--chart-4))', 'hsl(var(--chart-7))', 'hsl(var(--muted-foreground))',
        ];
        const types: Record<string, { count: number; area: number }> = {};
        floorFilteredSpaces.forEach((space: any) => {
            const name = space.commonName || space.name || 'Unknown';
            if (!types[name]) types[name] = { count: 0, area: 0 };
            types[name].count++;
            types[name].area += extractSpaceArea(space);
        });
        return Object.entries(types)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 6)
            .map(([name, data], i) => ({ name: name.length > 18 ? name.substring(0, 18) + '...' : name, fullName: name, value: data.count, area: Math.round(data.area), color: colors[i % colors.length] }));
    }, [floorFilteredSpaces]);

    const sensorRooms = useMemo(() => {
        let filtered = floorFilteredSpaces;
        if (selectedRoomType) {
            filtered = filtered.filter((s: any) => {
                const name = s.commonName || s.name || 'Unknown';
                return name === selectedRoomType;
            });
        }
        return filtered.slice(0, 60).map((s: any) => ({
            fmGuid: s.fmGuid,
            commonName: s.commonName,
            name: s.name,
            levelFmGuid: s.levelFmGuid,
        }));
    }, [floorFilteredSpaces, selectedRoomType]);

    // Filtered alarm list for FM grid
    const filteredAlarmList = useMemo(() => {
        let list = alarmList;
        if (alarmLevelFilter) {
            list = list.filter((a: any) => a.level_fm_guid === alarmLevelFilter);
        }
        if (alarmSearch) {
            const q = alarmSearch.toLowerCase();
            list = list.filter((a: any) => {
                const room = a.in_room_fm_guid ? roomLookup.get(a.in_room_fm_guid.toLowerCase()) : null;
                const lvl = a.level_fm_guid ? levelNames.get(a.level_fm_guid.toLowerCase()) : '';
                return (room?.commonName || '').toLowerCase().includes(q) ||
                       (room?.name || '').toLowerCase().includes(q) ||
                       (lvl || '').toLowerCase().includes(q);
            });
        }
        return list;
    }, [alarmList, alarmLevelFilter, alarmSearch, roomLookup, levelNames]);

    const iotMachineMap = useMemo(() => {
        const m = new Map<string, any>();
        buildingIoT?.machines.forEach(machine => {
            if (machine.code) m.set(machine.code, machine.latest_values);
        });
        return m;
    }, [buildingIoT]);

    const sensorRoomValues = useMemo(() => sensorRooms.map(room => {
        const live = iotMachineMap.get(room.fmGuid);
        const value = live?.[sensorMetric] ?? generateMockSensorData(room.fmGuid, sensorMetric);
        return { ...room, value };
    }), [sensorRooms, iotMachineMap, sensorMetric]);

    const sensorMetricDef = SENSOR_METRICS.find(m => m.key === sensorMetric)!;



    // Calculate actual stats from allData for this building (REAL for hierarchy, DB for assets)
    const stats = useMemo(() => {
        let totalArea = 0;
        buildingSpaces.forEach((space: any) => {
            totalArea += extractSpaceArea(space);
        });

        // Space types grouped by commonName (REAL from allData)
        const spaceTypes: Record<string, number> = {};
        buildingSpaces.forEach((space: any) => {
            const name = space.commonName || space.name || 'Unknown';
            spaceTypes[name] = (spaceTypes[name] || 0) + 1;
        });

        // Deduplicate floors: strip model suffix like " - 01", " - 02" and count unique
        const uniqueFloors = new Set(buildingStoreys.map((s: any) =>
            (s.commonName || s.fmGuid).replace(/\s*-\s*\d+$/, '')
        ));

        return { 
            floorCount: uniqueFloors.size,
            roomCount: buildingSpaces.length, 
            assetCount: dbAssetCount,
            totalArea: Math.round(totalArea),
            assetCategories: dbAssetCategories,
            spaceTypes,
        };
    }, [buildingSpaces, buildingStoreys, dbAssetCount, dbAssetCategories]);

    // Navigation helper: open 3D viewer with context + insights color map
    const navigateToInsights3D = useCallback((opts: {
        mode: 'energy_floors' | 'energy_floor' | 'asset_categories' | 'asset_category' | 'room_types' | 'room_type' | 'room_spaces';
        colorMap: Record<string, [number, number, number]>;
        entity?: string;
        assetType?: string;
    }) => {
        // Save color map to sessionStorage for AssetPlusViewer to read
        sessionStorage.setItem('insights_color_map', JSON.stringify({
            mode: opts.mode,
            colorMap: opts.colorMap,
        }));
        const params = new URLSearchParams({ building: facility.fmGuid, mode: '3d', insightsMode: opts.mode, xray: 'true' });
        if (opts.entity) params.set('entity', opts.entity);
        if (opts.assetType) params.set('assetType', opts.assetType);
        if (!facility.fmGuid) { toast.error('Building GUID missing'); return; }
        navigate(`/viewer?${params.toString()}`);
    }, [facility.fmGuid, navigate]);

    // Dual-path handler: drawerMode dispatches event, desktop updates inline viewer, mobile navigates
    const handleInsightsClick = useCallback((opts: {
        mode: 'energy_floors' | 'energy_floor' | 'asset_categories' | 'asset_category' | 'room_types' | 'room_type' | 'room_spaces';
        colorMap: Record<string, [number, number, number]>;
        entity?: string;
        assetType?: string;
    }) => {
        // Build a name-based color map for fallback matching in the viewer
        // (fmGuids from Asset+ may differ from xeokit originalSystemId)
        const nameColorMap: Record<string, [number, number, number]> = {};
        const isFloorMode = opts.mode.startsWith('energy_floor');
        const isRoomMode = opts.mode === 'room_spaces' || opts.mode === 'room_type' || opts.mode === 'room_types';
        
        if (isFloorMode) {
            // Map storey names → colors
            Object.entries(opts.colorMap).forEach(([fmGuid, rgb]) => {
                const storey = buildingStoreys.find((s: any) => s.fmGuid === fmGuid);
                if (storey) {
                    const name = (storey.commonName || storey.name || '').toLowerCase().trim();
                    if (name) nameColorMap[name] = rgb;
                }
            });
        } else if (isRoomMode) {
            // Map room names → colors
            Object.entries(opts.colorMap).forEach(([fmGuid, rgb]) => {
                const space = buildingSpaces.find((s: any) => s.fmGuid === fmGuid);
                if (space) {
                    const name = (space.commonName || space.name || '').toLowerCase().trim();
                    if (name) nameColorMap[name] = rgb;
                }
            });
        }

        const detail = { mode: opts.mode, colorMap: opts.colorMap, nameColorMap };

        if (drawerMode) {
            // Force spaces visible first, then apply coloring after a short delay
            // so NativeXeokitViewer has time to process the space visibility change
            window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { show: true } }));
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_UPDATE_EVENT, { detail }));
            }, 150);
        } else if (isMobile) {
            navigateToInsights3D(opts);
        } else {
            setInlineInsightsMode(opts.mode);
            setInlineColorMap(opts.colorMap);
            window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_UPDATE_EVENT, { detail }));
        }
    }, [isMobile, drawerMode, navigateToInsights3D, buildingStoreys, buildingSpaces]);

    // Helper: build color map from room values and push to 3D
    const colorizeAllSensorRooms = useCallback(() => {
        const roomColorMap: Record<string, [number, number, number]> = {};
        sensorRoomValues.forEach((room: any) => {
            if (room.value !== null) {
                const rgb = getVisualizationColor(room.value, sensorMetric);
                if (rgb) roomColorMap[room.fmGuid] = rgb;
            }
        });
        handleInsightsClick({ mode: 'room_spaces', colorMap: roomColorMap });
    }, [sensorRoomValues, sensorMetric, handleInsightsClick]);

    // Helper: colorize only selected rooms
    const colorizeSelectedSensorRooms = useCallback((guids: Set<string>) => {
        const roomColorMap: Record<string, [number, number, number]> = {};
        sensorRoomValues.forEach((room: any) => {
            if (guids.has(room.fmGuid) && room.value !== null) {
                const rgb = getVisualizationColor(room.value, sensorMetric);
                if (rgb) roomColorMap[room.fmGuid] = rgb;
            }
        });
        handleInsightsClick({ mode: 'room_spaces', colorMap: roomColorMap });
    }, [sensorRoomValues, sensorMetric, handleInsightsClick]);

    // Auto-colorize when switching metrics (if sensor tab is active)
    useEffect(() => {
        if (activeTab !== 'performance') return;
        if (sensorRoomValues.length === 0) return;
        if (!drawerMode && isMobile) return;
        const roomColorMap: Record<string, [number, number, number]> = {};
        sensorRoomValues.forEach((room: any) => {
            if (room.value !== null) {
                const rgb = getVisualizationColor(room.value, sensorMetric);
                if (rgb) roomColorMap[room.fmGuid] = rgb;
            }
        });
        const nameColorMap: Record<string, [number, number, number]> = {};
        sensorRoomValues.forEach((room: any) => {
            if (room.value !== null) {
                const name = (room.commonName || room.name || '').toLowerCase().trim();
                const rgb = getVisualizationColor(room.value, sensorMetric);
                if (name && rgb) nameColorMap[name] = rgb;
            }
        });
        const detail = { mode: 'room_spaces', colorMap: roomColorMap, nameColorMap };
        setInlineInsightsMode('room_spaces');
        setInlineColorMap(roomColorMap);
        window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_UPDATE_EVENT, { detail }));
    }, [sensorMetric, sensorRoomValues, activeTab]);

    // Clear selection when metric changes
    useEffect(() => {
        setSelectedSensorRooms(new Set());
    }, [sensorMetric]);

    const handleInlineFullscreen = useCallback(() => {
        if (inlineInsightsMode && inlineColorMap) {
            navigateToInsights3D({ mode: inlineInsightsMode as any, colorMap: inlineColorMap });
        } else {
            const params = new URLSearchParams({ building: facility.fmGuid, mode: '3d' });
            navigate(`/viewer?${params.toString()}`);
        }
    }, [inlineInsightsMode, inlineColorMap, navigateToInsights3D, facility.fmGuid, navigate]);

    // Legacy simple navigation (for non-colormap views)
    const navigateTo3D = (opts?: { entity?: string; visualization?: string; assetType?: string }) => {
        if (!facility.fmGuid) { toast.error('Building GUID missing'); return; }
        const params = new URLSearchParams({ building: facility.fmGuid, mode: '3d' });
        if (opts?.entity) params.set('entity', opts.entity);
        if (opts?.visualization) params.set('visualization', opts.visualization);
        if (opts?.assetType) params.set('assetType', opts.assetType);
        navigate(`/viewer?${params.toString()}`);
    };

    // Floor-by-floor energy data (MOCK) — include fmGuid for chart click navigation
    // Deduplicate floors by base name (strip " - 01", " - 02" suffix from model copies)
    const energyByFloor = useMemo(() => {
        const seen = new Set<string>();
        const result: { name: string; fmGuid: string; kwhPerSqm: number; color: string }[] = [];
        buildingStoreys.forEach((storey: any) => {
            const baseName = (storey.commonName || storey.name || '').replace(/\s*-\s*\d+$/, '');
            if (!baseName || seen.has(baseName)) return;
            seen.add(baseName);
            const hash = hashString(storey.fmGuid || '');
            result.push({
                name: baseName,
                fmGuid: storey.fmGuid,
                kwhPerSqm: 80 + (hash % 60),
                color: FLOOR_COLORS[result.length % FLOOR_COLORS.length],
            });
        });
        return result;
    }, [buildingStoreys]);

    const renderPieLabel = isMobile 
        ? undefined 
        : ({ name, value, percent, x, y, midAngle }: any) => {
            const RADIAN = Math.PI / 180;
            const textAnchor = Math.cos(-midAngle * RADIAN) >= 0 ? 'start' : 'end';
            return (
                <text x={x} y={y} fill="hsl(var(--foreground))" textAnchor={textAnchor} dominantBaseline="central" className="text-xs">
                    {`${name} (${value})`}
                </text>
            );
        };

    const renderEnergyPieLabel = isMobile
        ? undefined
        : ({ name, value, x, y, midAngle }: any) => {
            const RADIAN = Math.PI / 180;
            const textAnchor = Math.cos(-midAngle * RADIAN) >= 0 ? 'start' : 'end';
            return (
                <text x={x} y={y} fill="hsl(var(--foreground))" textAnchor={textAnchor} dominantBaseline="central" className="text-xs">
                    {`${name} ${value}%`}
                </text>
            );
        };

    // Prepare asset category pie data (REAL)
    const assetCategoryPie = useMemo(() => {
        const colors = [
            'hsl(var(--chart-2))', 'hsl(var(--chart-4))', 'hsl(var(--chart-1))',
            'hsl(var(--chart-5))', 'hsl(var(--chart-3))', 'hsl(var(--chart-7))',
        ];
        return Object.entries(stats.assetCategories)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, value], i) => ({ name, value, color: colors[i % colors.length] }));
    }, [stats.assetCategories]);

    // (spaceTypePie is now defined earlier, respecting floor filter)

    return (
        <div className="h-full p-2 sm:p-3 md:p-4 lg:p-6 overflow-y-auto">
            {/* Page Header — hidden in drawer mode (panel provides its own header) */}
            {!drawerMode && (
                <div className="mb-4 sm:mb-6 flex items-start gap-3">
                    <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5 shrink-0">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground">
                            {facility.commonName || facility.name}
                        </h1>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                            Building insights and analytics
                        </p>
                    </div>
                </div>
            )}

            {/* KPI Cards - REAL counts — hidden in drawerMode to save space */}
            {!drawerMode && <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-4 sm:mb-6">
                {[
                    { title: 'Floors', value: stats.floorCount, icon: Layers, color: 'text-[hsl(var(--chart-2))]', onView: () => setActiveTab('space') },
                    { title: 'Rooms', value: stats.roomCount, icon: DoorOpen, color: 'text-[hsl(var(--chart-3))]', onView: () => navigateTo3D({ visualization: 'area' }) },
                    { title: 'Assets', value: stats.assetCount, icon: Package, color: 'text-[hsl(var(--chart-7))]', onView: () => navigateTo3D() },
                    { title: 'Area (m²)', value: stats.totalArea.toLocaleString(), icon: Building2, color: 'text-primary', onView: () => navigateTo3D({ visualization: 'area' }) },
                    { title: 'Avg. Energy', value: `${80 + (hashString(facility.fmGuid || '') % 40)} kWh/m²`, icon: Zap, color: 'text-[hsl(var(--chart-4))]' },
                    { title: 'Energy Rating', value: ['A', 'B', 'C'][hashString(facility.fmGuid || '') % 3], icon: Gauge, color: 'text-primary' },
                ].map((kpi, index) => (
                    <Card key={index} className={kpi.onView ? 'group cursor-pointer border-primary/20 hover:border-primary/50 transition-colors touch-action-manipulation' : ''} onClick={kpi.onView}>
                        <CardContent className="p-3 sm:p-4">
                            <div className="flex items-center justify-between mb-1">
                                <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color}`} />
                                <div className="flex items-center gap-1">
                                    {kpi.onView && <ViewerLink />}
                                </div>
                            </div>
                            <p className="text-lg sm:text-xl font-bold text-foreground">
                                {kpi.value}
                            </p>
                            <p className="text-[10px] sm:text-xs text-muted-foreground">{kpi.title}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>}

            {/* Main content: Tabs + Desktop inline 3D viewer */}
            <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                    {/* Tabs: Performance, Space, Asset */}
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <div className="overflow-x-auto -mx-2 px-2 pb-1 mb-4 sm:mb-6">
                            <TabsList className="inline-flex w-max min-w-full sm:w-full sm:min-w-0 h-auto p-0.5 sm:p-1 gap-0.5 sm:gap-1">
                                <TabsTrigger value="performance" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Performance
                                </TabsTrigger>
                                <TabsTrigger value="space" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Space
                                </TabsTrigger>
                                <TabsTrigger value="asset" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    Asset
                                </TabsTrigger>
                                <TabsTrigger value="fm" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2 gap-1">
                                    <Bell className="h-3 w-3" />
                                    Alarms
                                    {alarmCount > 0 && (
                                        <Badge variant="destructive" className="text-[9px] h-4 px-1 ml-0.5">{alarmCount > 999 ? '999+' : alarmCount}</Badge>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="predictive" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    🔮 Predictive
                                </TabsTrigger>
                                <TabsTrigger value="optimization" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    📐 Optimization
                                </TabsTrigger>
                                <TabsTrigger value="rag" className="text-[10px] sm:text-xs md:text-sm whitespace-nowrap px-2 sm:px-3 py-1.5 sm:py-2">
                                    🔍 RAG Search
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {/* Performance Tab - mostly MOCK energy data */}
                        <TabsContent value="performance" className="mt-0 space-y-6">
                            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                                {/* Energy per Floor - MOCK */}
                                {energyByFloor.length > 0 && (
                                <Card className="border-primary/20 hover:border-primary/50 transition-colors">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Zap className="h-4 w-4 text-[hsl(var(--chart-4))]" />
                                                Energy per Floor
                                                <span className="ml-auto cursor-pointer" onClick={() => {
                                                    const roomColorMap: Record<string, [number, number, number]> = {};
                                                    energyByFloor.forEach(f => {
                                                        const floorColor = hslStringToRgbFloat(f.color);
                                                        buildingSpaces.forEach((space: any) => {
                                                            if (space.levelFmGuid === f.fmGuid) {
                                                                roomColorMap[space.fmGuid] = floorColor;
                                                            }
                                                        });
                                                        roomColorMap[f.fmGuid] = floorColor;
                                                    });
                                                    handleInsightsClick({ mode: 'room_spaces', colorMap: roomColorMap });
                                                }}><ViewerLink /></span>
                                            </CardTitle>
                                            <CardDescription>kWh per m² by floor level · Click bar for 3D</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="h-64 cursor-pointer">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart data={energyByFloor} layout="vertical">
                                                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                                        <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                                                        <YAxis 
                                                            dataKey="name" type="category" 
                                                            width={isMobile ? 60 : 80}
                                                            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }}
                                                        />
                                                        <Bar dataKey="kwhPerSqm" name="kWh/m²" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}>
                                                            {energyByFloor.map((entry, index) => (
                                                                <Cell key={`cell-${index}`} fill={entry.color} onClick={() => {
                                                                     // Resolve storey to child rooms STRICTLY for this floor only
                                                                     const floorColor = hslStringToRgbFloat(entry.color);
                                                                     const roomColorMap: Record<string, [number, number, number]> = {};
                                                                     // Find ALL storey fmGuids that share this base name (across model copies)
                                                                     const baseName = entry.name;
                                                                     const matchingStoreyGuids = new Set<string>();
                                                                     buildingStoreys.forEach((s: any) => {
                                                                         const sBaseName = (s.commonName || s.name || '').replace(/\s*-\s*\d+$/, '');
                                                                         if (sBaseName === baseName) matchingStoreyGuids.add(s.fmGuid);
                                                                     });
                                                                     // Only include rooms that belong to this specific floor
                                                                     buildingSpaces.forEach((space: any) => {
                                                                         if (matchingStoreyGuids.has(space.levelFmGuid)) {
                                                                             roomColorMap[space.fmGuid] = floorColor;
                                                                         }
                                                                     });
                                                                     // Also include storey guids themselves for model matching
                                                                     matchingStoreyGuids.forEach(g => { roomColorMap[g] = floorColor; });
                                                                     handleInsightsClick({ mode: 'energy_floor', colorMap: roomColorMap });
                                                                }} />
                                                            ))}
                                                        </Bar>
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                {/* Energy Distribution - MOCK */}
                                <Card className="border-primary/20 hover:border-primary/50 transition-colors">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <ThermometerSun className="h-4 w-4 text-[hsl(var(--chart-4))]" />
                                            Energy Distribution
                                            <span className="ml-auto cursor-pointer" onClick={() => {
                                                const roomColorMap: Record<string, [number, number, number]> = {};
                                                energyByFloor.forEach(f => {
                                                    const floorColor = hslStringToRgbFloat(f.color);
                                                    buildingSpaces.forEach((space: any) => {
                                                        if (space.levelFmGuid === f.fmGuid) {
                                                            roomColorMap[space.fmGuid] = floorColor;
                                                        }
                                                    });
                                                    roomColorMap[f.fmGuid] = floorColor;
                                                });
                                                handleInsightsClick({ mode: 'room_spaces', colorMap: roomColorMap });
                                            }}><ViewerLink /></span>
                                        </CardTitle>
                                        <CardDescription>Breakdown by category</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="h-64">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie data={energyDistribution} cx="50%" cy="50%" innerRadius={isMobile ? 40 : 45} outerRadius={isMobile ? 65 : 75} paddingAngle={2} dataKey="value" label={renderEnergyPieLabel} labelLine={!isMobile}>
                                                        {energyDistribution.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} style={{ cursor: 'pointer' }} onClick={() => {
                                                                // Resolve all floors to child rooms for reliable 3D matching
                                                                const categoryColor = hslStringToRgbFloat(entry.color);
                                                                const roomColorMap: Record<string, [number, number, number]> = {};
                                                                energyByFloor.forEach(f => {
                                                                    buildingSpaces.forEach((space: any) => {
                                                                        if (space.levelFmGuid === f.fmGuid) {
                                                                            roomColorMap[space.fmGuid] = categoryColor;
                                                                        }
                                                                    });
                                                                    roomColorMap[f.fmGuid] = categoryColor;
                                                                });
                                                                handleInsightsClick({ mode: 'room_spaces', colorMap: roomColorMap });
                                                            }} />
                                                        ))}
                                                    </Pie>
                                                    {!isMobile && <Legend formatter={(value: string) => <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>} />}
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Monthly Trend - MOCK */}
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Droplets className="h-4 w-4 text-[hsl(var(--chart-2))]" />
                                        Monthly Energy Trend
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={monthlyTrend}>
                                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                                <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                                                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                                                <Legend formatter={(value: string) => <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>} />
                                                <Line type="monotone" dataKey="consumption" name="Actual" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))' }} />
                                                <Line type="monotone" dataKey="target" name="Target" stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="5 5" dot={{ fill: 'hsl(var(--chart-3))' }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* Space Tab - REAL room data */}
                        <TabsContent value="space" className="mt-0 space-y-6">
                             {/* Floor filter pills — above pie chart */}
                             {spaceFloorOptions.length > 1 && (
                                 <Carousel opts={{ align: 'start', dragFree: true }} className="w-full">
                                     <CarouselContent className="-ml-1">
                                         <CarouselItem className="pl-1 basis-auto">
                                             <Button
                                                 size="sm"
                                                 variant={spaceFloorFilter === '' ? 'default' : 'outline'}
                                                 className="h-6 px-2 text-[10px] rounded-full whitespace-nowrap"
                                                  onClick={() => {
                                                      setSpaceFloorFilter(''); setSelectedRoomType('');
                                                      if (drawerMode) {
                                                          window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: { floorId: null, isAllFloorsVisible: true } as FloorSelectionEventDetail }));
                                                      }
                                                  }}
                                              >
                                                 All
                                             </Button>
                                         </CarouselItem>
                                         {spaceFloorOptions.map(opt => (
                                             <CarouselItem key={opt.guid} className="pl-1 basis-auto">
                                                 <Button
                                                     size="sm"
                                                     variant={spaceFloorFilter === opt.name ? 'default' : 'outline'}
                                                     className="h-6 px-2 text-[10px] rounded-full whitespace-nowrap"
                                                      onClick={() => {
                                                          setSpaceFloorFilter(opt.name); setSelectedRoomType('');
                                                          if (drawerMode) {
                                                              // Collect all storey fmGuids matching this floor name
                                                              const matchingFmGuids = buildingStoreys
                                                                  .filter((s: any) => (s.commonName || '').replace(/\s*-\s*\d+$/, '') === opt.name)
                                                                  .map((s: any) => s.fmGuid)
                                                                  .filter(Boolean);
                                                              window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
                                                                  detail: { floorId: opt.guid, visibleFloorFmGuids: matchingFmGuids, isAllFloorsVisible: false } as FloorSelectionEventDetail
                                                              }));
                                                          }
                                                      }}
                                                 >
                                                     {opt.name}
                                                 </Button>
                                             </CarouselItem>
                                         ))}
                                     </CarouselContent>
                                 </Carousel>
                             )}

                            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                                {/* Room Types Distribution - REAL */}
                                <Card className="border-primary/20 hover:border-primary/50 transition-colors">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <DoorOpen className="h-4 w-4 text-[hsl(var(--chart-3))]" />
                                            Room Types
                                            <span className="ml-auto cursor-pointer" onClick={() => {
                                                const nameColorMap: Record<string, [number, number, number]> = {};
                                                spaceTypePie.forEach(s => { nameColorMap[s.fullName] = hslStringToRgbFloat(s.color); });
                                                const roomColorMap: Record<string, [number, number, number]> = {};
                                                floorFilteredSpaces.forEach((space: any) => {
                                                    const name = space.commonName || space.name || 'Unknown';
                                                    const color = nameColorMap[name];
                                                    if (color) roomColorMap[space.fmGuid] = color;
                                                });
                                                handleInsightsClick({ mode: 'room_spaces', colorMap: roomColorMap });
                                            }}><ViewerLink /></span>
                                        </CardTitle>
                                        <CardDescription>
                                            {floorFilteredSpaces.length} rooms{spaceFloorFilter ? ` on ${spaceFloorFilter}` : ''} · {stats.totalArea.toLocaleString()} m²
                                            {selectedRoomType && <> · filtered: <strong>{selectedRoomType}</strong> <span className="cursor-pointer text-primary hover:underline" onClick={() => setSelectedRoomType('')}>(clear)</span></>}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="h-64">
                                            {spaceTypePie.length > 0 ? (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie data={spaceTypePie} cx="50%" cy="50%" innerRadius={isMobile ? 40 : 50} outerRadius={isMobile ? 65 : 80} paddingAngle={2} dataKey="value" label={renderPieLabel} labelLine={!isMobile}>
                                                            {spaceTypePie.map((entry, index) => (
                                                                <Cell
                                                                    key={`cell-${index}`}
                                                                    fill={entry.color}
                                                                    style={{ cursor: 'pointer', opacity: selectedRoomType && selectedRoomType !== entry.fullName ? 0.3 : 1 }}
                                                                    onClick={() => {
                                                                        const newType = selectedRoomType === entry.fullName ? '' : entry.fullName;
                                                                        setSelectedRoomType(newType);
                                                                        // Color matching rooms in 3D
                                                                        const roomColorMap: Record<string, [number, number, number]> = {};
                                                                        const targetSpaces = newType
                                                                            ? floorFilteredSpaces.filter((s: any) => (s.commonName || s.name || 'Unknown') === newType)
                                                                            : floorFilteredSpaces;
                                                                        const nameColorMap2: Record<string, [number, number, number]> = {};
                                                                        if (newType) {
                                                                            const rgb = hslStringToRgbFloat(entry.color);
                                                                            targetSpaces.forEach((s: any) => { roomColorMap[s.fmGuid] = rgb; });
                                                                            nameColorMap2[newType.toLowerCase().trim()] = rgb;
                                                                        } else {
                                                                            spaceTypePie.forEach(pie => {
                                                                                const rgb = hslStringToRgbFloat(pie.color);
                                                                                floorFilteredSpaces.filter((s: any) => (s.commonName || s.name || 'Unknown') === pie.fullName)
                                                                                    .forEach((s: any) => { roomColorMap[s.fmGuid] = rgb; });
                                                                            });
                                                                        }
                                                                        handleInsightsClick({ mode: 'room_spaces', colorMap: roomColorMap });
                                                                    }}
                                                                />
                                                            ))}
                                                        </Pie>
                                                        <Legend formatter={(value: string) => <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div className="h-full flex items-center justify-center text-muted-foreground">No room data</div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                             </div>

                             {/* ── Sensor content (merged from Sensors tab) ── */}
                             <div className="space-y-4 mt-6">

                                 {/* Metric buttons */}
                                 <div className="flex flex-wrap gap-1.5 items-center justify-between">
                                     <div className="flex items-center gap-2">
                                         {iotLoading && (
                                             <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                                                 <Loader2 className="h-2.5 w-2.5 animate-spin" />Loading…
                                             </span>
                                         )}
                                         {!iotLoading && iotLive && (
                                             <span className="inline-flex items-center gap-1 text-[9px] text-green-400 border border-green-500/40 rounded-full px-1.5 py-0 bg-green-500/10">
                                                 <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse inline-block" />LIVE
                                             </span>
                                         )}
                                     </div>
                                     <div className="flex gap-1">
                                         {SENSOR_METRICS.map(m => (
                                             <Button
                                                 key={m.key}
                                                 size="sm"
                                                 variant={sensorMetric === m.key ? 'default' : 'outline'}
                                                 className="h-7 px-2 text-[10px] gap-1"
                                                 onClick={() => setSensorMetric(m.key)}
                                             >
                                                 <m.icon className="h-3 w-3" />
                                                 {m.label}
                                             </Button>
                                         ))}
                                     </div>
                                 </div>

                                 {/* Room heatmap with inline "Visa rum i 3D" button */}
                                 <Card>
                                     <CardHeader className="pb-2">
                                         <div className="flex items-center justify-between">
                                             <CardTitle className="text-sm flex items-center gap-2">
                                                 <sensorMetricDef.icon className="h-4 w-4" style={{ color: sensorMetricDef.color }} />
                                                 Room Heatmap – {sensorMetricDef.label}
                                             </CardTitle>
                                              <Button
                                                   variant="outline"
                                                   size="sm"
                                                   className="h-7 px-2 text-[10px] gap-1"
                                                   onClick={() => {
                                                       colorizeAllSensorRooms();
                                                   }}
                                               >
                                                   <Eye className="h-3 w-3" />
                                                   View all
                                               </Button>
                                         </div>
                                          <CardDescription>
                                             {sensorRooms.length} of {floorFilteredSpaces.length} rooms{spaceFloorFilter ? ` on ${spaceFloorFilter}` : ''}{selectedRoomType ? ` · type: ${selectedRoomType}` : ''} · click to select · Ctrl+click for multi-select
                                         </CardDescription>
                                     </CardHeader>
                                     <CardContent>
                                         {/* Show Dashboard button — appears when a room is selected */}
                                         {selectedSensorRooms.size > 0 && sensorSheetRoom && (
                                             <div className="mb-2 flex items-center gap-2">
                                                 <Button
                                                     variant="default"
                                                     size="sm"
                                                     className="h-7 px-3 text-[10px] gap-1"
                                                     onClick={() => setSensorSheetOpen(true)}
                                                 >
                                                     <BarChart2 className="h-3 w-3" />
                                                     Show Dashboard
                                                     <span className="text-[9px] opacity-80 ml-1">({sensorSheetRoom.name})</span>
                                                 </Button>
                                                 <Button
                                                     variant="ghost"
                                                     size="sm"
                                                     className="h-7 px-2 text-[10px]"
                                                     onClick={() => {
                                                         setSelectedSensorRooms(new Set());
                                                         setSensorSheetRoom(null);
                                                         // Reset 3D colors
                                                         window.dispatchEvent(new CustomEvent(INSIGHTS_COLOR_RESET_EVENT));
                                                     }}
                                                 >
                                                     <X className="h-3 w-3" />
                                                     Clear
                                                 </Button>
                                             </div>
                                         )}
                                         {sensorRooms.length === 0 ? (
                                             <p className="text-sm text-muted-foreground text-center py-8">No rooms found</p>
                                         ) : (
                                              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5">
                                                  {[...sensorRoomValues].sort((a, b) => {
                                                      // Sort by status: highest values first (red/warning), lowest last (green/ok)
                                                      if (a.value === null && b.value === null) return 0;
                                                      if (a.value === null) return 1;
                                                      if (b.value === null) return -1;
                                                      return b.value - a.value;
                                                  }).map(room => {
                                                     const rgb = room.value !== null ? getVisualizationColor(room.value, sensorMetric) : null;
                                                     const hex = rgb ? rgbToHex(rgb) : undefined;
                                                     return (
                                                         <div
                                                              key={room.fmGuid}
                                                              className={cn(
                                                                  "rounded-lg border text-center p-2.5 cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-md active:scale-95",
                                                                  selectedSensorRooms.has(room.fmGuid) && "ring-2 ring-primary ring-offset-1"
                                                              )}
                                                              style={{
                                                                  backgroundColor: hex ? hex + '22' : undefined,
                                                                  borderColor: hex ? hex + '55' : undefined,
                                                              }}
                                                              onClick={(e) => {
                                                                  if (e.ctrlKey || e.metaKey) {
                                                                      // Multi-select: toggle this room in selection
                                                                      setSelectedSensorRooms(prev => {
                                                                          const next = new Set(prev);
                                                                          if (next.has(room.fmGuid)) next.delete(room.fmGuid);
                                                                          else next.add(room.fmGuid);
                                                                          // Colorize only selected rooms in 3D
                                                                          colorizeSelectedSensorRooms(next);
                                                                          return next;
                                                                      });
                                                                  } else {
                                                                      // Single click: select only this room + colorize (no auto-open sheet)
                                                                      const single = new Set([room.fmGuid]);
                                                                      setSelectedSensorRooms(single);
                                                                      colorizeSelectedSensorRooms(single);
                                                                      setSensorSheetRoom({ fmGuid: room.fmGuid, name: room.commonName || room.name || room.fmGuid });
                                                                  }
                                                              }}
                                                          >
                                                             <div className="text-[10px] text-muted-foreground truncate mb-0.5">
                                                                 {room.commonName || room.name || room.fmGuid.substring(0, 6)}
                                                             </div>
                                                             <div className="text-base font-bold leading-none" style={{ color: hex ?? 'hsl(var(--foreground))' }}>
                                                                 {room.value !== null ? room.value.toFixed(1) : '—'}
                                                             </div>
                                                             <div className="text-[9px] text-muted-foreground">{sensorMetricDef.unit}</div>
                                                         </div>
                                                     );
                                                 })}
                                             </div>
                                         )}
                                     </CardContent>
                                 </Card>

                                 {/* Status */}
                                 {!iotLoading && iotLive && buildingIoT && (
                                     <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-green-500/30 px-3 py-2 bg-green-500/5">
                                         <Wifi className="h-3.5 w-3.5 shrink-0 text-green-400" />
                                         <span>Live data from Senslinc · {buildingIoT.machines.length} sensors</span>
                                     </div>
                                 )}

                                 {/* Room sensor sheet */}
                                 <RoomSensorDetailSheet
                                     key={sensorSheetRoom?.fmGuid ?? 'none'}
                                     open={sensorSheetOpen}
                                     onClose={() => setSensorSheetOpen(false)}
                                     roomFmGuid={sensorSheetRoom?.fmGuid ?? null}
                                     roomName={sensorSheetRoom?.name}
                                 />
                             </div>
                         </TabsContent>

                        {/* Asset Tab - REAL asset data */}
                        <TabsContent value="asset" className="mt-0 space-y-6">
                             {/* Floor filter pills — same as Space tab */}
                             {spaceFloorOptions.length > 1 && (
                                 <Carousel opts={{ align: 'start', dragFree: true }} className="w-full">
                                     <CarouselContent className="-ml-1">
                                         <CarouselItem className="pl-1 basis-auto">
                                             <Button
                                                 size="sm"
                                                 variant={assetFloorFilter === '' ? 'default' : 'outline'}
                                                 className="h-6 px-2 text-[10px] rounded-full whitespace-nowrap"
                                                 onClick={() => {
                                                     setAssetFloorFilter('');
                                                     if (drawerMode) {
                                                         window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: { floorId: null, isAllFloorsVisible: true } as FloorSelectionEventDetail }));
                                                     }
                                                 }}
                                             >
                                                 All
                                             </Button>
                                         </CarouselItem>
                                         {spaceFloorOptions.map(opt => (
                                             <CarouselItem key={opt.guid} className="pl-1 basis-auto">
                                                 <Button
                                                     size="sm"
                                                     variant={assetFloorFilter === opt.name ? 'default' : 'outline'}
                                                     className="h-6 px-2 text-[10px] rounded-full whitespace-nowrap"
                                                     onClick={() => {
                                                         setAssetFloorFilter(opt.name);
                                                         if (drawerMode) {
                                                             const matchingFmGuids = buildingStoreys
                                                                 .filter((s: any) => (s.commonName || '').replace(/\s*-\s*\d+$/, '') === opt.name)
                                                                 .map((s: any) => s.fmGuid)
                                                                 .filter(Boolean);
                                                             window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, {
                                                                 detail: { floorId: opt.guid, visibleFloorFmGuids: matchingFmGuids, isAllFloorsVisible: false } as FloorSelectionEventDetail
                                                             }));
                                                         }
                                                     }}
                                                 >
                                                     {opt.name}
                                                 </Button>
                                             </CarouselItem>
                                         ))}
                                     </CarouselContent>
                                 </Carousel>
                             )}
                            <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
                                {/* Asset Category Distribution - REAL */}
                                <Card className="border-primary/20 hover:border-primary/50 transition-colors">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Package className="h-4 w-4 text-primary" />
                                            Asset Categories
                                            <span className="ml-auto cursor-pointer" onClick={() => {
                                                const colorMap: Record<string, [number, number, number]> = {};
                                                assetCategoryPie.forEach(c => { colorMap[c.name] = hslStringToRgbFloat(c.color); });
                                                handleInsightsClick({ mode: 'asset_categories', colorMap });
                                            }}><ViewerLink /></span>
                                        </CardTitle>
                                        <CardDescription>{stats.assetCount} assets (real data) · Click segment for 3D</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="h-64">
                                            {assetCategoryPie.length > 0 ? (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie data={assetCategoryPie} cx="50%" cy="50%" innerRadius={isMobile ? 40 : 50} outerRadius={isMobile ? 65 : 80} paddingAngle={2} dataKey="value" label={renderPieLabel} labelLine={!isMobile}>
                                                            {assetCategoryPie.map((entry, index) => (
                                                                <Cell key={`cell-${index}`} fill={entry.color} style={{ cursor: 'pointer' }} onClick={() => {
                                                                    const colorMap: Record<string, [number, number, number]> = {};
                                                                    colorMap[entry.name] = hslStringToRgbFloat(entry.color);
                                                                    handleInsightsClick({ mode: 'asset_category', colorMap, assetType: entry.name });
                                                                }} />
                                                            ))}
                                                        </Pie>
                                                        
                                                        <Legend formatter={(value: string) => <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div className="h-full flex items-center justify-center text-muted-foreground">No asset data</div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>


                        {/* ── FM Tab — REAL IfcAlarm data ── */}
                        <TabsContent value="fm" className="mt-0 space-y-4">
                            {/* Live badge + KPI row */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[9px] text-green-400 border border-green-500/40 rounded-full px-1.5 py-0.5 bg-green-500/10">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />LIVE
                                </span>
                                <span className="text-xs text-muted-foreground">Alarm objects from database</span>
                                {!showAlarmManagement && (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="ml-auto gap-1.5"
                                            onClick={() => {
                                                if (drawerMode) {
                                                    // Dispatch event — viewer is listening
                                                    const alarmsForViewer = alarmList
                                                        .slice(0, 50)
                                                        .map((a: any) => ({ fmGuid: a.fm_guid, roomFmGuid: a.in_room_fm_guid }));
                                                    window.dispatchEvent(new CustomEvent(ALARM_ANNOTATIONS_SHOW_EVENT, { detail: { alarms: alarmsForViewer, flyTo: true } }));
                                                } else {
                                                    // Navigate to viewer
                                                    navigateTo3D({ visualization: 'alarms' });
                                                }
                                            }}
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                             View all in 3D
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5"
                                            onClick={() => setShowAlarmManagement(true)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Manage alarms
                                        </Button>
                                    </>
                                )}
                                {showAlarmManagement && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="ml-auto"
                                        onClick={() => setShowAlarmManagement(false)}
                                    >
                                        ← Overview
                                    </Button>
                                )}
                            </div>

                            {showAlarmManagement ? (
                                <AlarmManagementTab
                                    buildingFmGuid={facility.fmGuid}
                                    buildingName={facility.commonName || facility.name}
                                    onAlarmsDeleted={() => {
                                        setAlarmRefreshKey(k => k + 1);
                                        setShowAlarmManagement(false);
                                    }}
                                />
                            ) : (
                                <>
                                    {/* KPI cards */}
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        <Card>
                                            <CardContent className="p-4">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <Bell className="h-4 w-4 text-destructive" />
                                                </div>
                                                <p className="text-2xl font-bold">{alarmCount.toLocaleString()}</p>
                                                <p className="text-xs text-muted-foreground">Total alarms</p>
                                            </CardContent>
                                        </Card>
                                        <Card>
                                            <CardContent className="p-4">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <Layers className="h-4 w-4 text-primary" />
                                                </div>
                                                <p className="text-2xl font-bold">{alarmsByLevel.length}</p>
                                                <p className="text-xs text-muted-foreground">Floors with alarms</p>
                                            </CardContent>
                                        </Card>
                                        <Card>
                                            <CardContent className="p-4">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <DoorOpen className="h-4 w-4 text-orange-500" />
                                                </div>
                                                <p className="text-2xl font-bold">
                                                    {alarmsByLevel.length > 0
                                                        ? Math.round(alarmCount / Math.max(alarmsByLevel.length, 1))
                                                        : 0}
                                                </p>
                                                <p className="text-xs text-muted-foreground">Avg. per floor</p>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* Chart: alarms per level */}
                                    {alarmsByLevel.length > 0 && (
                                        <Card>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    <Bell className="h-4 w-4 text-destructive" />
                                                     Alarms per Floor
                                                </CardTitle>
                                                <CardDescription>Alarm count per floor (real data) · Click bar to filter</CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-3">
                                                <div className="flex gap-2">
                                                    <div className="flex-1 h-56">
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <BarChart data={alarmsByLevel} layout="vertical">
                                                                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                                                <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                                                                <YAxis dataKey="levelName" type="category" width={isMobile ? 60 : 100} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: isMobile ? 10 : 12 }} />
                                                                
                                                                <Bar dataKey="count" name="Alarms" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}>
                                                                    {alarmsByLevel.map((entry, index) => (
                                                                        <Cell
                                                                            key={`cell-${index}`}
                                                                            fill={alarmLevelFilter === entry.levelGuid ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                                                                            onClick={() => setAlarmLevelFilter(prev => prev === entry.levelGuid ? '' : entry.levelGuid)}
                                                                        />
                                                                    ))}
                                                                </Bar>
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                    {/* MapPin buttons aligned to the right of bars */}
                                                    <div className="flex flex-col justify-between py-1 shrink-0" style={{ height: '14rem' }}>
                                                        {alarmsByLevel.map((level) => (
                                                            <Button
                                                                key={level.levelGuid}
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 text-primary hover:bg-primary/10"
                                                                title={`Show ${level.count} alarms for ${level.levelName}`}
                                                                onClick={() => {
                                                                    const levelAlarms = alarmList
                                                                        .filter((a: any) => a.level_fm_guid === level.levelGuid)
                                                                        .slice(0, 50)
                                                                        .map((a: any) => ({ fmGuid: a.fm_guid, roomFmGuid: a.in_room_fm_guid }));
                                                                    if (isMobile && !drawerMode) {
                                                                        sessionStorage.setItem('pending_alarm_annotations', JSON.stringify({ alarms: levelAlarms }));
                                                                        navigate(`/viewer?building=${facility.fmGuid}&mode=3d`);
                                                                    } else {
                                                                        window.dispatchEvent(new CustomEvent(ALARM_ANNOTATIONS_SHOW_EVENT, { detail: { alarms: levelAlarms, flyTo: true } }));
                                                                    }
                                                                }}
                                                            >
                                                                <MapPin className="h-3.5 w-3.5" />
                                                            </Button>
                                                        ))}
                                                    </div>
                                                </div>
                                                {alarmLevelFilter && (
                                                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setAlarmLevelFilter('')}>
                                                        <X className="h-3 w-3" /> Show all floors
                                                    </Button>
                                                )}
                                            </CardContent>
                                        </Card>
                                    )}

                                    {/* Recent alarm list — enriched with room names */}
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Bell className="h-4 w-4 text-destructive" />
                                                {alarmLevelFilter
                                                     ? `Alarms — ${alarmsByLevel.find(l => l.levelGuid === alarmLevelFilter)?.levelName || 'Selected floor'}`
                                                     : 'Latest 50 alarms'
                                                }
                                            </CardTitle>
                                            <div className="relative mt-2">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                                <Input
                                                    placeholder="Search room name, number, floor…"
                                                    value={alarmSearch}
                                                    onChange={(e) => setAlarmSearch(e.target.value)}
                                                    className="h-8 pl-8 text-xs"
                                                />
                                                {alarmSearch && (
                                                    <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6" onClick={() => setAlarmSearch('')}>
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </CardHeader>
                                        <CardContent className="p-0">
                                            <div className="overflow-x-auto">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                             <TableHead>Room Name</TableHead>
                                                             <TableHead>Room No.</TableHead>
                                                             <TableHead>Floor</TableHead>
                                                             <TableHead>Date</TableHead>
                                                            <TableHead className="w-10">3D</TableHead>
                                                            <TableHead className="w-10"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {filteredAlarmList.map((alarm: any) => {
                                                            const room = alarm.in_room_fm_guid ? roomLookup.get(alarm.in_room_fm_guid.toLowerCase()) : null;
                                                            const lvlName = alarm.level_fm_guid ? levelNames.get(alarm.level_fm_guid.toLowerCase()) : null;
                                                            return (
                                                                <TableRow key={alarm.id}>
                                                                    <TableCell className="text-xs">{room?.commonName || '—'}</TableCell>
                                                                    <TableCell className="text-xs font-mono text-muted-foreground">{room?.name || '—'}</TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{lvlName || 'Floor (unknown)'}</TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{new Date(alarm.updated_at).toLocaleDateString('sv-SE')}</TableCell>
                                                                    <TableCell>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 text-primary hover:bg-primary/10"
                                                                            title="Show annotation and zoom to alarm"
                                                                            onClick={() => {
                                                                                const alarms = [{ fmGuid: alarm.fm_guid, roomFmGuid: alarm.in_room_fm_guid }];
                                                                                if (isMobile && !drawerMode) {
                                                                                    sessionStorage.setItem('pending_alarm_annotations', JSON.stringify({ alarms, flyTo: true }));
                                                                                    navigate(`/viewer?building=${facility.fmGuid}&mode=3d`);
                                                                                } else {
                                                                                    window.dispatchEvent(new CustomEvent(ALARM_ANNOTATIONS_SHOW_EVENT, { detail: { alarms, flyTo: true } }));
                                                                                }
                                                                            }}
                                                                        >
                                                                            <Eye className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                                                            title="Delete alarm"
                                                                            onClick={async () => {
                                                                                await supabase.from('assets').delete().eq('fm_guid', alarm.fm_guid);
                                                                                setAlarmRefreshKey(k => k + 1);
                                                                            }}
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                        {filteredAlarmList.length === 0 && (
                                                            <TableRow>
                                                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                                    {alarmSearch || alarmLevelFilter ? 'No matching alarms' : 'No alarms found'}
                                                                </TableCell>
                                                            </TableRow>
                                                        )}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </>
                            )}
                        </TabsContent>

                        {/* ML Tabs */}
                        <TabsContent value="predictive" className="mt-0">
                            <PredictiveMaintenanceTab facility={facility} />
                        </TabsContent>
                        <TabsContent value="optimization" className="mt-0">
                            <RoomOptimizationTab facility={facility} />
                        </TabsContent>
                        <TabsContent value="rag" className="mt-0">
                            <RagSearchTab facility={facility} />
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Desktop inline 3D viewer — hidden in drawerMode (already inside the 3D viewer) */}
                {!isMobile && !drawerMode && (
                    <InsightsInlineViewer
                        fmGuid={facility.fmGuid}
                        insightsColorMode={inlineInsightsMode}
                        insightsColorMap={inlineColorMap}
                        onFullscreen={handleInlineFullscreen}
                        expanded={inlineExpanded}
                        onToggleExpand={() => setInlineExpanded(prev => !prev)}
                    />
                )}
            </div>
        </div>
    );
}
