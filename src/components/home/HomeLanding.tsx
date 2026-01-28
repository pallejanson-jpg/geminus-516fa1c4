import React, { useCallback, useState, useContext, useMemo } from "react";
import { Database, FileQuestion, Sparkles, Building2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import chicagoHero from "@/assets/chicago-skyline-hero.jpg";
import GunnarChat from "@/components/chat/GunnarChat";
import { useFavoriteBuildings } from "@/hooks/useBuildingSettings";
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
  { id: "ilean", title: "Ilean", subtitle: "Document Assistant", description: "Sök i dokument och ritningar", icon: FileQuestion, available: false },
  { id: "doris", title: "Doris", subtitle: "FM Access Assistant", description: "Integration med FM Access", icon: Sparkles, available: false },
];

export default function HomeLanding() {
  const { toast } = useToast();
  const [gunnarOpen, setGunnarOpen] = useState(false);
  const { favorites, isLoading: isLoadingFavorites } = useFavoriteBuildings();
  const { navigatorTreeData, setSelectedFacility, setActiveApp, allData, activeApp } = useContext(AppContext);

  // Helper to extract NTA value from attributes (dynamic key names like "nta51780ACD...")
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

  // Get favorite buildings from navigator tree data
  const favoriteBuildings = useMemo(() => {
    return navigatorTreeData
      .filter(building => favorites.includes(building.fmGuid))
      .map((building, index) => {
        // Get spaces for this building from allData
        const buildingSpaces = allData.filter(
          (a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid
        );
        
        // Get storeys for this building from allData (more reliable than tree children)
        const buildingStoreys = allData.filter(
          (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === building.fmGuid
        );
        
        // Calculate total area by summing NTA from each space's attributes
        const totalArea = buildingSpaces.reduce((sum: number, space: any) => {
          const nta = extractNtaFromAttributes(space.attributes);
          return sum + nta;
        }, 0);

        return {
          fmGuid: building.fmGuid,
          name: building.name,
          commonName: building.commonName,
          category: 'Building' as const,
          image: BUILDING_IMAGES[index % BUILDING_IMAGES.length],
          numberOfLevels: buildingStoreys.length,
          numberOfSpaces: buildingSpaces.length,
          area: Math.round(totalArea), // Round to integer
          address: building.attributes?.address || undefined,
          complexCommonName: building.complexCommonName || undefined,
        };
      });
  }, [navigatorTreeData, favorites, allData]);

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
    <div className="relative min-h-full">
      {/* Full-page background */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${chicagoHero})` }}
        aria-hidden="true"
      />
      {/* Overlay for readability (uses design tokens) */}
      <div className="pointer-events-none absolute inset-0 bg-background/70" aria-hidden="true" />

      <div className="relative z-10 min-h-full flex flex-col items-center px-4 sm:px-6 py-6">
        <header className="space-y-2 text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Welcome to My SWG</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Your digital backbone for digital twins and property data</p>
        </header>

      <section className="space-y-3 w-full max-w-4xl mb-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold">AI Assistants</h2>
          <p className="text-sm text-muted-foreground">Quick help for data, documents and integrations</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ASSISTANTS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => openAssistant(a.id)}
                disabled={!a.available}
                className={`rounded-xl border border-border bg-card/60 p-4 text-left transition-colors ${
                  a.available ? 'hover:bg-muted hover:border-primary/50' : 'opacity-60 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${a.available ? 'bg-primary/10' : 'bg-muted'}`}>
                    <Icon className={`h-5 w-5 ${a.available ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold leading-none">{a.title}</span>
                      {!a.available && (
                        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">Kommer snart</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{a.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="w-full max-w-4xl flex-1">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-lg">My Favorites</CardTitle>
            <CardDescription>Quick access to your most used buildings</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingFavorites ? (
              <div className="text-center py-4 text-sm text-muted-foreground">
                Loading favorites...
              </div>
            ) : favoriteBuildings.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {favoriteBuildings.map((building) => (
                  <button
                    key={building.fmGuid}
                    type="button"
                    onClick={() => handleBuildingClick(building)}
                    className="rounded-xl border border-border bg-card/80 overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-lg group"
                  >
                    <div className="h-24 relative overflow-hidden">
                      <img 
                        src={building.image} 
                        alt={building.commonName || building.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute bottom-2 left-3 right-3">
                        <h3 className="font-semibold text-white text-sm truncate">
                          {building.commonName || building.name}
                        </h3>
                      </div>
                    </div>
                    <div className="p-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{building.numberOfLevels || 0} floors</span>
                      <span>{building.numberOfSpaces || 0} rooms</span>
                      <span>{building.area?.toLocaleString() || 0} m²</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Building2 className="h-8 w-8 opacity-50" />
                  <div>
                    <p className="text-sm font-medium">No favorites yet</p>
                    <p className="text-xs">Mark buildings as favorites from the Portfolio to see them here.</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      </div>

      {/* Gunnar Chat Modal - with home context */}
      <GunnarChat 
        open={gunnarOpen} 
        onClose={() => setGunnarOpen(false)} 
        context={{ activeApp: 'home' }}
      />
    </div>
  );
}
