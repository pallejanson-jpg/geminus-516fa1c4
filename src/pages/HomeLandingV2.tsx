/**
 * HomeLandingV2 — Test page for two-column desktop layout.
 * Route: /home-v2 (no nav link, same pattern as /presentation).
 */

import React, { useCallback, useState, useContext, useMemo, useEffect } from "react";
import { Database, FileQuestion, Sparkles, Building2, Eye, Activity, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import ParticleBackground from "@/components/home/ParticleBackground";
import GunnarChat from "@/components/chat/GunnarChat";
import { useAllBuildingSettings } from "@/hooks/useAllBuildingSettings";
import { AppContext } from "@/context/AppContext";
import { BUILDING_IMAGES } from "@/lib/constants";
import { extractNtaFromAttributes } from "@/lib/building-utils";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel";

type AssistantType = "gunnar" | "ilean" | "doris";

const ASSISTANTS: Array<{
  id: AssistantType;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
}> = [
  { id: "gunnar", title: "Geminus AI", subtitle: "Data Assistant", description: "Ask about buildings, rooms and assets", icon: Database, available: true },
  { id: "ilean", title: "Ilean", subtitle: "Document Assistant", description: "Search documents and drawings", icon: FileQuestion, available: true },
  { id: "doris", title: "Doris", subtitle: "FM Access Assistant", description: "Integration with FM Access", icon: Sparkles, available: false },
];

const RECENT_KEY = 'geminus-recent-buildings';

interface RecentBuilding {
  fmGuid: string;
  name: string;
  image: string;
  timestamp: number;
  numberOfLevels: number;
  numberOfSpaces: number;
  area: number;
}

interface SavedView {
  id: string;
  name: string;
  screenshot_url: string | null;
  building_name: string | null;
  building_fm_guid: string;
  created_at: string | null;
}

interface PortfolioKPIs {
  totalBuildings: number;
  totalArea: number;
  openWorkOrders: number;
  activeIssues: number;
}

interface RecentActivity {
  id: string;
  type: 'work_order' | 'issue';
  title: string;
  building: string;
  timestamp: string;
  status: string;
}

function readRecentBuildings(): RecentBuilding[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch { return []; }
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card/80 overflow-hidden">
      <Skeleton className="h-32 sm:h-36 w-full" />
      <div className="p-2.5 sm:p-3 flex items-center justify-between">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}

export default function HomeLandingV2() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [gunnarOpen, setGunnarOpen] = useState(false);
  const { settingsMap, isLoading: isLoadingSettings, getFavorites, getHeroImage } = useAllBuildingSettings();
  const { navigatorTreeData, setSelectedFacility, setActiveApp, allData } = useContext(AppContext);

  const [recentBuildings, setRecentBuildings] = useState<RecentBuilding[]>(() => readRecentBuildings());
  useEffect(() => { setRecentBuildings(readRecentBuildings()); }, []);

  // Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [loadingViews, setLoadingViews] = useState(true);

  // Portfolio KPIs
  const [kpis, setKpis] = useState<PortfolioKPIs | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);

  // Recent activity
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      // Views
      const { data: views } = await supabase
        .from('saved_views')
        .select('id, name, screenshot_url, building_name, building_fm_guid, created_at')
        .order('created_at', { ascending: false })
        .limit(6);
      setSavedViews(views || []);
      setLoadingViews(false);

      // KPIs
      const [buildingsRes, woRes, issuesRes] = await Promise.all([
        supabase.from('assets').select('fm_guid, gross_area', { count: 'exact' }).eq('category', 'Building'),
        supabase.from('work_orders').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('bcf_issues').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      ]);
      const totalArea = (buildingsRes.data || []).reduce((sum, b) => sum + (Number(b.gross_area) || 0), 0);
      setKpis({
        totalBuildings: buildingsRes.count || 0,
        totalArea: Math.round(totalArea),
        openWorkOrders: woRes.count || 0,
        activeIssues: issuesRes.count || 0,
      });
      setLoadingKpis(false);

      // Recent activity
      const { data: recentWo } = await supabase
        .from('work_orders')
        .select('id, title, building_name, created_at, status')
        .order('created_at', { ascending: false })
        .limit(5);
      const { data: recentIssues } = await supabase
        .from('bcf_issues')
        .select('id, title, building_name, created_at, status')
        .order('created_at', { ascending: false })
        .limit(5);

      const combined: RecentActivity[] = [
        ...(recentWo || []).map(wo => ({
          id: wo.id, type: 'work_order' as const, title: wo.title,
          building: wo.building_name || '', timestamp: wo.created_at, status: wo.status,
        })),
        ...(recentIssues || []).map(i => ({
          id: i.id, type: 'issue' as const, title: i.title,
          building: i.building_name || '', timestamp: i.created_at, status: i.status,
        })),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8);

      setRecentActivity(combined);
      setLoadingActivity(false);
    };
    fetchAll();
  }, []);

  const treeDataReady = navigatorTreeData.length > 0;

  const enrichedRecent = useMemo(() => {
    if (!treeDataReady) return recentBuildings.slice(0, 6);
    return recentBuildings.slice(0, 6).map((rb, index) => {
      const liveBuilding = navigatorTreeData.find(b => b.fmGuid === rb.fmGuid);
      if (!liveBuilding) return rb;
      const buildingSpaces = allData.filter((a: any) => a.category === 'Space' && a.buildingFmGuid === rb.fmGuid);
      const buildingStoreys = allData.filter((a: any) => a.category === 'Building Storey' && a.buildingFmGuid === rb.fmGuid);
      const totalArea = buildingSpaces.reduce((sum: number, space: any) => sum + extractNtaFromAttributes(space.attributes), 0);
      const heroImage = getHeroImage(rb.fmGuid, BUILDING_IMAGES[index % BUILDING_IMAGES.length]);
      return {
        ...rb,
        name: liveBuilding.commonName || liveBuilding.name || rb.name,
        image: heroImage,
        numberOfLevels: buildingStoreys.length,
        numberOfSpaces: buildingSpaces.length,
        area: Math.round(totalArea),
      };
    });
  }, [recentBuildings, treeDataReady, navigatorTreeData, allData, getHeroImage]);

  const openAssistant = useCallback(
    (type: AssistantType) => {
      if (type === "gunnar") { setGunnarOpen(true); return; }
      toast({ title: "AI Assistant (coming soon)", description: `${type} is not yet implemented.` });
    },
    [toast],
  );

  const handleBuildingClick = (building: any) => {
    setSelectedFacility({ fmGuid: building.fmGuid, name: building.name, commonName: building.name, category: 'Building' });
    setActiveApp('portfolio');
  };

  const handleViewClick = (view: SavedView) => {
    navigate(`/split-viewer?building=${view.building_fm_guid}&mode=3d`);
  };

  const formatTimeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div className="relative min-h-screen text-foreground">
      <ParticleBackground />
      <div className="pointer-events-none absolute inset-0 bg-background/70" aria-hidden="true" />

      <div className="relative z-10 min-h-full flex flex-col items-center gap-4 sm:gap-6 px-3 sm:px-4 md:px-6 py-4 sm:py-6">
        {/* Two-column layout on desktop */}
        <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* ─── Left column: main content ─── */}
          <div className="flex flex-col gap-4 sm:gap-6">
            <header className="space-y-1 sm:space-y-2 text-center lg:text-left w-full">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-foreground">Welcome to My Geminus</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">Your digital backbone for digital twins</p>
            </header>

            {/* AI Assistants */}
            <section className="space-y-2 sm:space-y-3 w-full">
              <div className="text-center lg:text-left">
                <h2 className="text-base sm:text-lg font-semibold text-foreground">AI Assistants</h2>
                <p className="text-[11px] sm:text-xs text-muted-foreground">Quick help for data, documents and integrations</p>
              </div>
              <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-3">
                {ASSISTANTS.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => openAssistant(a.id)}
                      disabled={!a.available}
                      className={`rounded-xl border border-border bg-card/60 p-3 sm:p-4 text-left transition-colors ${
                        a.available ? 'hover:bg-muted hover:border-primary/50 active:bg-muted/80' : 'opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg shrink-0 ${a.available ? 'bg-primary/10' : 'bg-muted'}`}>
                          <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${a.available ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <span className="font-semibold text-sm sm:text-base leading-none text-foreground">{a.title}</span>
                            {!a.available && (
                              <span className="text-[11px] sm:text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Soon</span>
                            )}
                          </div>
                          <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 truncate">{a.description}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Recent Buildings */}
            <section className="w-full">
              <Card className="bg-card/60">
                <CardHeader className="pb-2 sm:pb-4">
                  <CardTitle className="text-base sm:text-lg text-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    Recent
                  </CardTitle>
                  <CardDescription className="text-[11px] sm:text-xs">Buildings you recently worked with</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {enrichedRecent.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-3 sm:p-4">
                      <div className="flex items-center gap-2 sm:gap-3 text-muted-foreground">
                        <Building2 className="h-6 w-6 sm:h-8 sm:w-8 opacity-50 shrink-0" />
                        <div>
                          <p className="text-xs sm:text-sm font-medium">No recent buildings</p>
                          <p className="text-[11px] sm:text-xs">Open a building from Portfolio to see it here.</p>
                        </div>
                      </div>
                    </div>
                  ) : enrichedRecent.length <= 3 ? (
                    <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-3">
                      {enrichedRecent.map((building) => (
                        <BuildingCard key={building.fmGuid} building={building} onClick={() => handleBuildingClick(building)} />
                      ))}
                    </div>
                  ) : (
                    <Carousel opts={{ align: 'start' }} className="w-full">
                      <CarouselContent className="-ml-2">
                        {enrichedRecent.map((building) => (
                          <CarouselItem key={building.fmGuid} className="pl-2 basis-full sm:basis-1/3">
                            <BuildingCard building={building} onClick={() => handleBuildingClick(building)} />
                          </CarouselItem>
                        ))}
                      </CarouselContent>
                      <CarouselPrevious className="hidden sm:flex -left-4" />
                      <CarouselNext className="hidden sm:flex -right-4" />
                    </Carousel>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Saved Views */}
            <section className="w-full flex-1">
              <Card className="bg-card/60">
                <CardHeader className="pb-2 sm:pb-4">
                  <CardTitle className="text-base sm:text-lg text-foreground flex items-center gap-2">
                    <Eye className="h-4 w-4 text-primary" />
                    Saved Views
                  </CardTitle>
                  <CardDescription className="text-[11px] sm:text-xs">Your most recently saved views</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {loadingViews ? (
                    <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-3">
                      <CardSkeleton />
                      <CardSkeleton />
                      <CardSkeleton />
                    </div>
                  ) : savedViews.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-3 sm:p-4">
                      <div className="flex items-center gap-2 sm:gap-3 text-muted-foreground">
                        <Eye className="h-6 w-6 sm:h-8 sm:w-8 opacity-50 shrink-0" />
                        <div>
                          <p className="text-xs sm:text-sm font-medium">No saved views</p>
                          <p className="text-[11px] sm:text-xs">Save a view from the 3D viewer to see it here.</p>
                        </div>
                      </div>
                    </div>
                  ) : savedViews.length <= 3 ? (
                    <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-3">
                      {savedViews.map((view) => (
                        <ViewCard key={view.id} view={view} onClick={() => handleViewClick(view)} />
                      ))}
                    </div>
                  ) : (
                    <Carousel opts={{ align: 'start' }} className="w-full">
                      <CarouselContent className="-ml-2">
                        {savedViews.map((view) => (
                          <CarouselItem key={view.id} className="pl-2 basis-full sm:basis-1/3">
                            <ViewCard view={view} onClick={() => handleViewClick(view)} />
                          </CarouselItem>
                        ))}
                      </CarouselContent>
                      <CarouselPrevious className="hidden sm:flex -left-4" />
                      <CarouselNext className="hidden sm:flex -right-4" />
                    </Carousel>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>

          {/* ─── Right column: Portfolio Summary + Activity (desktop only) ─── */}
          <div className="hidden lg:flex flex-col gap-4 pt-[72px]">
            {/* Portfolio Summary */}
            <Card className="bg-card/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Portfolio Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingKpis ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : kpis ? (
                  <div className="grid grid-cols-2 gap-2">
                    <KpiTile label="Buildings" value={kpis.totalBuildings.toString()} />
                    <KpiTile label="Total area" value={`${kpis.totalArea.toLocaleString()} m²`} />
                    <KpiTile label="Open work orders" value={kpis.openWorkOrders.toString()} highlight={kpis.openWorkOrders > 0} />
                    <KpiTile label="Active issues" value={kpis.activeIssues.toString()} highlight={kpis.activeIssues > 0} />
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="bg-card/60 flex-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingActivity ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                  </div>
                ) : recentActivity.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No recent activity.</p>
                ) : (
                  <div className="space-y-1">
                    {recentActivity.map((item) => (
                      <div key={item.id} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 mt-0.5">
                          {item.type === 'work_order' ? 'WO' : 'ISS'}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-foreground truncate">{item.title}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {item.building} · {formatTimeAgo(item.timestamp)}
                          </p>
                        </div>
                        <Badge
                          variant={item.status === 'open' ? 'destructive' : 'secondary'}
                          className="text-[9px] px-1 py-0 shrink-0"
                        >
                          {item.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <GunnarChat open={gunnarOpen} onClose={() => setGunnarOpen(false)} context={{ activeApp: 'home' }} />
    </div>
  );
}

function KpiTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "rounded-lg border border-border/50 p-3 text-center",
      highlight ? "bg-destructive/5 border-destructive/20" : "bg-card/40"
    )}>
      <p className={cn("text-lg font-bold", highlight ? "text-destructive" : "text-foreground")}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}

function BuildingCard({ building, onClick }: { building: RecentBuilding; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-border bg-card/80 overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-lg active:scale-[0.98] group"
    >
      <div className="h-32 sm:h-36 relative overflow-hidden">
        <img
          src={building.image}
          alt={building.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-1.5 sm:bottom-2 left-2 sm:left-3 right-2 sm:right-3">
          <h3 className="font-semibold text-white text-xs sm:text-sm truncate">{building.name}</h3>
        </div>
      </div>
      <div className="p-2.5 sm:p-3 flex items-center justify-between text-[11px] sm:text-xs text-muted-foreground">
        <span>{building.numberOfLevels || 0} fl</span>
        <span>{building.numberOfSpaces || 0} rm</span>
        <span>{building.area?.toLocaleString() || 0} m²</span>
      </div>
    </button>
  );
}

const ViewCard = React.forwardRef<HTMLButtonElement, { view: SavedView; onClick: () => void }>(function ViewCard({ view, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="rounded-xl border border-border bg-card/80 overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-lg active:scale-[0.98] group"
    >
      <div className="h-32 sm:h-36 relative overflow-hidden bg-muted">
        {view.screenshot_url ? (
          <img
            src={view.screenshot_url}
            alt={view.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Eye className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-1.5 sm:bottom-2 left-2 sm:left-3 right-2 sm:right-3">
          <h3 className="font-semibold text-white text-xs sm:text-sm truncate">{view.name}</h3>
        </div>
      </div>
      <div className="p-2.5 sm:p-3 text-[11px] sm:text-xs text-muted-foreground truncate">
        {view.building_name || 'Unknown building'}
      </div>
    </button>
  );
});
