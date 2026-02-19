import React, { useCallback, useState, useContext, useMemo, useEffect } from "react";
import { Database, FileQuestion, Sparkles, Building2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import chicagoHero from "@/assets/chicago-skyline-hero.jpg";
import GunnarChat from "@/components/chat/GunnarChat";
import { useAllBuildingSettings } from "@/hooks/useAllBuildingSettings";
import { AppContext } from "@/context/AppContext";
import { BUILDING_IMAGES } from "@/lib/constants";

type AssistantType = "gunnar" | "ilean" | "doris";

const ASSISTANTS: Array<{
  id: AssistantType;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
}> = [
  { id: "gunnar", title: "Gunnar", subtitle: "Data Assistant", description: "Fråga om byggnader, rum och tillgångar", icon: Database, available: true },
  { id: "ilean", title: "Ilean", subtitle: "Document Assistant", description: "Sök i dokument och ritningar", icon: FileQuestion, available: true },
  { id: "doris", title: "Doris", subtitle: "FM Access Assistant", description: "Integration med FM Access", icon: Sparkles, available: false },
];

const FAV_CACHE_KEY = 'geminus-fav-buildings-cache';

interface FavoriteBuilding {
  fmGuid: string;
  name: string;
  commonName?: string | null;
  category: 'Building';
  image: string;
  numberOfLevels: number;
  numberOfSpaces: number;
  area: number;
  address?: string;
  complexCommonName?: string;
}

function readCachedFavorites(): FavoriteBuilding[] {
  try {
    const raw = localStorage.getItem(FAV_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.buildings || [];
  } catch { return []; }
}

function writeCachedFavorites(buildings: FavoriteBuilding[]) {
  try {
    localStorage.setItem(FAV_CACHE_KEY, JSON.stringify({ buildings, timestamp: Date.now() }));
  } catch { /* quota exceeded etc */ }
}

// Helper to extract NTA value from attributes
const extractNtaFromAttributes = (attributes: Record<string, any> | undefined): number => {
  if (!attributes) return 0;
  for (const key of Object.keys(attributes)) {
    if (key.toLowerCase().startsWith('nta')) {
      const ntaObj = attributes[key];
      if (ntaObj && typeof ntaObj === 'object' && typeof ntaObj.value === 'number') {
        return ntaObj.value;
      }
    }
  }
  return 0;
};

function FavoriteBuildingSkeleton() {
  return (
    <div className="rounded-lg sm:rounded-xl border border-border bg-card/80 overflow-hidden">
      <Skeleton className="h-20 sm:h-24 w-full" />
      <div className="p-2 sm:p-3 flex items-center justify-between">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}

export default function HomeLanding() {
  const { toast } = useToast();
  const [gunnarOpen, setGunnarOpen] = useState(false);
  const { settingsMap, isLoading: isLoadingSettings, getFavorites, getHeroImage } = useAllBuildingSettings();
  const { navigatorTreeData, setSelectedFacility, setActiveApp, allData, activeApp } = useContext(AppContext);

  // Cached favorites from localStorage for instant display
  const [cachedBuildings] = useState<FavoriteBuilding[]>(() => readCachedFavorites());

  const favorites = useMemo(() => getFavorites(), [getFavorites]);

  // Determine if tree data has loaded (non-empty means loaded)
  const treeDataReady = navigatorTreeData.length > 0;

  // Compute favorite buildings from live data
  const favoriteBuildings = useMemo(() => {
    if (!treeDataReady) return [];
    return navigatorTreeData
      .filter(building => favorites.includes(building.fmGuid))
      .map((building, index) => {
        const buildingSpaces = allData.filter(
          (a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid
        );
        const buildingStoreys = allData.filter(
          (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === building.fmGuid
        );
        const totalArea = buildingSpaces.reduce((sum: number, space: any) => {
          return sum + extractNtaFromAttributes(space.attributes);
        }, 0);
        const heroImage = getHeroImage(building.fmGuid, BUILDING_IMAGES[index % BUILDING_IMAGES.length]);

        return {
          fmGuid: building.fmGuid,
          name: building.name,
          commonName: building.commonName,
          category: 'Building' as const,
          image: heroImage,
          numberOfLevels: buildingStoreys.length,
          numberOfSpaces: buildingSpaces.length,
          area: Math.round(totalArea),
          address: building.attributes?.address || undefined,
          complexCommonName: building.complexCommonName || undefined,
        };
      });
  }, [navigatorTreeData, favorites, allData, getHeroImage, treeDataReady]);

  // Write to cache when live data changes
  useEffect(() => {
    if (favoriteBuildings.length > 0) {
      writeCachedFavorites(favoriteBuildings);
    }
  }, [favoriteBuildings]);

  // Decide what to display: live data > cached data
  const displayBuildings = favoriteBuildings.length > 0 ? favoriteBuildings : cachedBuildings;
  const isStillLoading = !treeDataReady || isLoadingSettings;
  const showSkeleton = isStillLoading && displayBuildings.length === 0;
  const showEmpty = !isStillLoading && displayBuildings.length === 0;

  const openAssistant = useCallback(
    (type: AssistantType) => {
      if (type === "gunnar") {
        setGunnarOpen(true);
        return;
      }
      toast({
        title: "AI Assistant (coming soon)",
        description: `You clicked on ${type}. This assistant is not yet implemented.`,
      });
    },
    [toast],
  );

  const handleBuildingClick = (building: any) => {
    setSelectedFacility(building);
    setActiveApp('portfolio');
  };

  return (
    <div className="relative min-h-full text-foreground">
      {/* Full-page background */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${chicagoHero})` }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-background/70" aria-hidden="true" />

      {/* Main layout */}
      <div className="relative z-10 min-h-full flex flex-col items-center gap-4 sm:gap-6 px-3 sm:px-4 md:px-6 py-4 sm:py-6">

        <div className="flex flex-col items-center w-full max-w-2xl">

          <header className="space-y-1 sm:space-y-2 text-center mb-4 sm:mb-6 w-full">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-foreground">Welcome to My Geminus</h1>
            <p className="text-xs sm:text-sm md:text-base text-muted-foreground">Your digital backbone for digital twins</p>
          </header>

          {/* AI Assistants */}
          <section className="space-y-2 sm:space-y-3 w-full mb-4 sm:mb-6">
            <div className="text-center">
              <h2 className="text-base sm:text-lg font-semibold text-foreground">AI Assistants</h2>
              <p className="text-[11px] sm:text-sm text-muted-foreground">Quick help for data, documents and integrations</p>
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
                    className={`rounded-lg sm:rounded-xl border border-border bg-card/60 p-3 sm:p-4 text-left transition-colors ${
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
                            <span className="text-[9px] sm:text-[10px] bg-muted text-muted-foreground px-1 sm:px-1.5 py-0.5 rounded">Snart</span>
                          )}
                        </div>
                        <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 truncate">{a.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* My Favorites */}
          <section className="w-full flex-1">
            <Card className="bg-card/60">
              <CardHeader className="pb-2 sm:pb-4">
                <CardTitle className="text-base sm:text-lg text-foreground">My Favorites</CardTitle>
                <CardDescription className="text-[11px] sm:text-sm">Quick access to your most used buildings</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {showSkeleton ? (
                  <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2">
                    <FavoriteBuildingSkeleton />
                    <FavoriteBuildingSkeleton />
                    <FavoriteBuildingSkeleton />
                  </div>
                ) : displayBuildings.length > 0 ? (
                  <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2">
                    {displayBuildings.map((building) => (
                      <button
                        key={building.fmGuid}
                        type="button"
                        onClick={() => handleBuildingClick(building)}
                        className="rounded-lg sm:rounded-xl border border-border bg-card/80 overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-lg active:scale-[0.98] group"
                      >
                        <div className="h-20 sm:h-24 relative overflow-hidden">
                          <img
                            src={building.image}
                            alt={building.commonName || building.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          <div className="absolute bottom-1.5 sm:bottom-2 left-2 sm:left-3 right-2 sm:right-3">
                            <h3 className="font-semibold text-white text-xs sm:text-sm truncate">
                              {building.commonName || building.name}
                            </h3>
                          </div>
                        </div>
                        <div className="p-2 sm:p-3 flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
                          <span>{building.numberOfLevels || 0} fl</span>
                          <span>{building.numberOfSpaces || 0} rm</span>
                          <span>{building.area?.toLocaleString() || 0} m²</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : showEmpty ? (
                  <div className="rounded-lg border border-dashed border-border p-3 sm:p-4">
                    <div className="flex items-center gap-2 sm:gap-3 text-muted-foreground">
                      <Building2 className="h-6 w-6 sm:h-8 sm:w-8 opacity-50 shrink-0" />
                      <div>
                        <p className="text-xs sm:text-sm font-medium">No favorites yet</p>
                        <p className="text-[10px] sm:text-xs">Mark buildings as favorites from Portfolio.</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>

      <GunnarChat
        open={gunnarOpen}
        onClose={() => setGunnarOpen(false)}
        context={{ activeApp: 'home' }}
      />
    </div>
  );
}
