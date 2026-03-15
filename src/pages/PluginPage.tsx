/**
 * PluginPage — Standalone route for GeminusPluginMenu.
 * URL: /plugin?building=GUID&floor=GUID&room=GUID&source=external
 * Renders only the FAB menu with a transparent background,
 * designed to be opened as a companion popup or iframe overlay.
 *
 * If no building GUID is provided, shows a building selector fallback.
 */
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import GeminusPluginMenu from '@/components/viewer/GeminusPluginMenu';

interface BuildingOption {
  fm_guid: string;
  name: string;
}

export default function PluginPage() {
  const [params, setParams] = useSearchParams();
  const buildingParam = params.get('building') || undefined;
  const floorGuid = params.get('floor') || undefined;
  const roomGuid = params.get('room') || undefined;
  const source = params.get('source') || 'plugin';

  const [selectedBuilding, setSelectedBuilding] = useState<BuildingOption | null>(null);
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // If building param exists, use it directly
  const activeBuildingGuid = buildingParam || selectedBuilding?.fm_guid;
  const activeBuildingName = selectedBuilding?.name;

  // Load buildings when no building param
  useEffect(() => {
    if (buildingParam) return;
    setLoading(true);
    supabase
      .from('assets')
      .select('fm_guid, common_name, name')
      .eq('category', 'Building')
      .order('common_name', { ascending: true })
      .then(({ data }) => {
        if (data) {
          const unique = new Map<string, string>();
          data.forEach((d: any) => {
            const guid = d.fm_guid;
            if (guid && !unique.has(guid)) {
              unique.set(guid, d.common_name || d.name || guid);
            }
          });
          setBuildings(Array.from(unique, ([fm_guid, name]) => ({ fm_guid, name })));
        }
        setLoading(false);
      });
  }, [buildingParam]);

  // Show building selector if no building context
  if (!activeBuildingGuid) {
    const filtered = search
      ? buildings.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
      : buildings;

    return (
      <div className="fixed inset-0 bg-background flex flex-col">
        <div className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold text-foreground">Select building</h1>
          </div>
          <Input
            placeholder="Search building..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filtered.map((b) => (
                <button
                  key={b.fm_guid}
                  onClick={() => setSelectedBuilding(b)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm hover:bg-accent transition-colors min-h-[44px]"
                >
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{b.name}</span>
                </button>
              ))}
              {filtered.length === 0 && !loading && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  No buildings found
                </p>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background">
      <GeminusPluginMenu
        buildingFmGuid={activeBuildingGuid}
        buildingName={activeBuildingName}
        source={source}
        contextMetadata={{
          floorGuid,
          roomGuid,
          standalone: true,
        }}
      />
    </div>
  );
}
