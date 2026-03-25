import React, { useCallback, useState, useContext, useMemo, useEffect } from "react";
import { Database, FileQuestion, Sparkles, Building2, Eye, ChevronLeft, ChevronRight } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import GunnarChat from "@/components/chat/GunnarChat";
import { useAllBuildingSettings } from "@/hooks/useAllBuildingSettings";
import { AppContext } from "@/context/AppContext";
import { BUILDING_IMAGES } from "@/lib/constants";
import { extractSpaceArea } from "@/lib/building-utils";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel";

type AssistantType = "gunnar" | "ilean";

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

function readRecentBuildings(): RecentBuilding[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch { return []; }
}

export function trackRecentBuilding(building: { fmGuid: string; name: string; image?: string }) {
  try {
    const existing = readRecentBuildings();
    const filtered = existing.filter(b => b.fmGuid !== building.fmGuid);
    const entry: RecentBuilding = {
      fmGuid: building.fmGuid,
      name: building.name,
      image: building.image || '',
      timestamp: Date.now(),
      numberOfLevels: 0,
      numberOfSpaces: 0,
      area: 0,
    };
    const updated = [entry, ...filtered].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch { /* quota exceeded */ }
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

export default function HomeLanding() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [gunnarOpen, setGunnarOpen] = useState(false);
  const { settingsMap, isLoading: isLoadingSettings, getFavorites, getHeroImage } = useAllBuildingSettings();
  const { navigatorTreeData, setSelectedFacility, setActiveApp, allData } = useContext(AppContext);

  // Recent buildings from localStorage - re-read on each mount
  const [recentBuildings, setRecentBuildings] = useState<RecentBuilding[]>(() => readRecentBuildings());

  // Refresh recent list when component mounts (in case user navigated back)
  useEffect(() => {
    setRecentBuildings(readRecentBuildings());
  }, []);

  // Saved views from DB
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [loadingViews, setLoadingViews] = useState(true);

  useEffect(() => {
    const fetchViews = async () => {
      setLoadingViews(true);
      const { data } = await supabase
        .from('saved_views')
        .select('id, name, screenshot_url, building_name, building_fm_guid, created_at')
        .order('created_at', { ascending: false })
        .limit(6);
      setSavedViews(data || []);
      setLoadingViews(false);
    };
    fetchViews();
  }, []);

  const treeDataReady = navigatorTreeData.length > 0;

  // Build recent from live data, enriched with tree info
  const enrichedRecent = useMemo(() => {
    if (!treeDataReady) return recentBuildings.slice(0, 6);
    return recentBuildings.slice(0, 6).map((rb, index) => {
      const liveBuilding = navigatorTreeData.find(b => b.fmGuid === rb.fmGuid);
      if (!liveBuilding) return rb;
      const buildingSpaces = allData.filter((a: any) => a.category === 'Space' && a.buildingFmGuid === rb.fmGuid);
      const buildingStoreys = allData.filter((a: any) => a.category === 'Building Storey' && a.buildingFmGuid === rb.fmGuid);
      const totalArea = buildingSpaces.reduce((sum: number, space: any) => sum + extractSpaceArea(space), 0);
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

  return (
    <div className="relative min-h-screen text-foreground">
      {/* Full-page skyline background */}
      <img
        src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1920&auto=format&fit=crop"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-background/75" aria-hidden="true" />

      {/* Main layout */}
      <div className="relative z-10 min-h-full flex flex-col items-center gap-4 sm:gap-6 px-3 sm:px-4 md:px-6 py-4 sm:py-6">
        <div className="flex flex-col items-center w-full max-w-4xl">

          <header className="space-y-1 sm:space-y-2 text-center mb-4 sm:mb-6 w-full">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-foreground">Welcome to My Geminus</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Your digital backbone for digital twins</p>
          </header>

          {/* AI Assistants */}
          <section className="space-y-2 sm:space-y-3 w-full mb-4 sm:mb-6">
            <div className="text-center">
              <h2 className="text-base sm:text-lg font-semibold text-foreground">AI Assistants</h2>
              <p className="text-[11px] sm:text-xs text-muted-foreground">Quick help for data, documents and integrations</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
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
          <section className="w-full mb-4 sm:mb-6">
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
      </div>

      <GunnarChat open={gunnarOpen} onClose={() => setGunnarOpen(false)} context={{ activeApp: 'home' }} />
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
          loading="lazy"
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
            loading="lazy"
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
