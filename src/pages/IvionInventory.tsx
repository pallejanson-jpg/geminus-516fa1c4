import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, X, ChevronLeft, Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import IvionRegistrationPanel from '@/components/inventory/IvionRegistrationPanel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BuildingWithIvion {
  fm_guid: string;
  name: string;
  ivion_site_id: string;
}

const IvionInventory: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [formOpen, setFormOpen] = useState(false);
  const [buildings, setBuildings] = useState<BuildingWithIvion[]>([]);
  const [selectedBuildingFmGuid, setSelectedBuildingFmGuid] = useState<string>(
    searchParams.get('building') || ''
  );
  const [ivionUrl, setIvionUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedCount, setSavedCount] = useState(0);

  // Load buildings with Ivion configured
  useEffect(() => {
    const loadBuildings = async () => {
      setIsLoading(true);
      try {
        // Get building settings with ivion_site_id
        const { data: settings } = await supabase
          .from('building_settings')
          .select('fm_guid, ivion_site_id')
          .not('ivion_site_id', 'is', null);

        if (!settings?.length) {
          setBuildings([]);
          setIsLoading(false);
          return;
        }

        // Get building names from assets
        const fmGuids = settings.map(s => s.fm_guid);
        const { data: buildingAssets } = await supabase
          .from('assets')
          .select('fm_guid, name, common_name')
          .in('fm_guid', fmGuids)
          .eq('category', 'Building');

        const buildingsWithIvion: BuildingWithIvion[] = settings.map(s => {
          const asset = buildingAssets?.find(a => a.fm_guid === s.fm_guid);
          return {
            fm_guid: s.fm_guid,
            name: asset?.name || asset?.common_name || s.fm_guid,
            ivion_site_id: s.ivion_site_id!,
          };
        });

        setBuildings(buildingsWithIvion);

        // Auto-select if building param provided or only one building
        if (searchParams.get('building')) {
          setSelectedBuildingFmGuid(searchParams.get('building')!);
        } else if (buildingsWithIvion.length === 1) {
          setSelectedBuildingFmGuid(buildingsWithIvion[0].fm_guid);
        }
      } catch (err) {
        console.error('Error loading buildings:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadBuildings();
  }, [searchParams]);

  // Build Ivion URL when building is selected
  useEffect(() => {
    if (!selectedBuildingFmGuid) {
      setIvionUrl(null);
      return;
    }

    const building = buildings.find(b => b.fm_guid === selectedBuildingFmGuid);
    if (!building?.ivion_site_id) {
      setIvionUrl(null);
      return;
    }

    // Build Ivion URL
    const baseUrl = 'https://swg.iv.navvis.com';
    setIvionUrl(`${baseUrl}/?site=${building.ivion_site_id}`);
  }, [selectedBuildingFmGuid, buildings]);

  const handleAssetSaved = () => {
    setSavedCount(prev => prev + 1);
    // Keep form open for continuous registration
  };

  const handleClose = () => {
    navigate(-1);
  };

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Laddar 360°-inventering...</p>
        </div>
      </div>
    );
  }

  if (buildings.length === 0) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md text-center space-y-4">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">Ingen Ivion 360° konfigurerad</h2>
          <p className="text-muted-foreground">
            För att använda 360°-inventering måste minst en byggnad ha ett Ivion Site ID konfigurerat.
          </p>
          <Button onClick={handleClose}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Tillbaka
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative bg-background">
      {/* Header bar with building selector */}
      <div className="absolute top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-b shadow-sm">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <Select value={selectedBuildingFmGuid} onValueChange={setSelectedBuildingFmGuid}>
                <SelectTrigger className="w-[200px] md:w-[300px]">
                  <SelectValue placeholder="Välj byggnad..." />
                </SelectTrigger>
                <SelectContent>
                  {buildings.map(b => (
                    <SelectItem key={b.fm_guid} value={b.fm_guid}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {savedCount > 0 && (
            <div className="text-sm text-muted-foreground">
              {savedCount} tillgång{savedCount > 1 ? 'ar' : ''} sparade
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Ivion iframe */}
      {ivionUrl ? (
        <iframe
          src={ivionUrl}
          className="w-full h-full border-0 pt-14"
          allow="fullscreen; accelerometer; gyroscope"
          title="Ivion 360° View"
        />
      ) : (
        <div className="h-full flex items-center justify-center pt-14">
          <div className="text-center space-y-4">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">
              Välj en byggnad för att öppna 360°-vyn
            </p>
          </div>
        </div>
      )}

      {/* Floating registration button (FAB) */}
      {!formOpen && ivionUrl && (
        <Button
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-xl z-50 hover:scale-105 transition-transform"
          size="icon"
          onClick={() => setFormOpen(true)}
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Floating registration form */}
      {formOpen && (
        <IvionRegistrationPanel
          buildingFmGuid={selectedBuildingFmGuid}
          ivionSiteId={buildings.find(b => b.fm_guid === selectedBuildingFmGuid)?.ivion_site_id || null}
          onClose={() => setFormOpen(false)}
          onSaved={handleAssetSaved}
        />
      )}
    </div>
  );
};

export default IvionInventory;
