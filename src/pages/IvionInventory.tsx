import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Building2, Loader2, Camera, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import IvionRegistrationPanel from '@/components/inventory/IvionRegistrationPanel';
import UnplacedAssetsPanel from '@/components/inventory/UnplacedAssetsPanel';
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

interface IvionPoiData {
  id: number;
  titles: Record<string, string>;
  location: { x: number; y: number; z: number };
  pointOfView?: { imageId: number };
}

const IvionInventory: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [formOpen, setFormOpen] = useState(false);
  const [unplacedPanelOpen, setUnplacedPanelOpen] = useState(false);
  const [buildings, setBuildings] = useState<BuildingWithIvion[]>([]);
  const [selectedBuildingFmGuid, setSelectedBuildingFmGuid] = useState<string>(
    searchParams.get('building') || ''
  );
  const [ivionUrl, setIvionUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedCount, setSavedCount] = useState(0);

  // POI polling state
  const [lastSeenPoiId, setLastSeenPoiId] = useState<number | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [detectedPoi, setDetectedPoi] = useState<IvionPoiData | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);

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

  // Get the current ivion site id
  const currentIvionSiteId = buildings.find(b => b.fm_guid === selectedBuildingFmGuid)?.ivion_site_id || null;

  // POI Polling - detect new POIs created in Ivion
  useEffect(() => {
    if (!currentIvionSiteId || !pollingEnabled || formOpen) {
      // Clear any existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const pollForNewPois = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('ivion-poi', {
          body: {
            action: 'get-latest-poi',
            siteId: currentIvionSiteId,
          },
        });

        // Check if we got a valid POI
        if (!error && data?.id && data?.location) {
          // If this is a new POI (different from last seen)
          if (data.id !== lastSeenPoiId) {
            console.log('New POI detected:', data.id, 'previous:', lastSeenPoiId);
            
            if (lastSeenPoiId !== null) {
              // This is a genuinely new POI (not the first poll)
              setDetectedPoi(data);
              setFormOpen(true);
            }
            
            setLastSeenPoiId(data.id);
          }
        }
      } catch (err) {
        // Silent fail - polling is a background feature
        console.log('POI polling error (non-critical):', err);
      }
    };

    // Initial poll to establish baseline
    pollForNewPois();

    // Poll every 3 seconds
    pollingIntervalRef.current = window.setInterval(pollForNewPois, 3000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [currentIvionSiteId, pollingEnabled, formOpen, lastSeenPoiId]);

  const handleAssetSaved = () => {
    setSavedCount(prev => prev + 1);
    setDetectedPoi(null); // Clear the detected POI
    // Keep form open for continuous registration
  };

  const handleAssetSavedAndClose = () => {
    setSavedCount(prev => prev + 1);
    setFormOpen(false);
    setDetectedPoi(null);
    navigate('/inventory'); // Navigate back to main inventory page
  };

  const handleClose = () => {
    navigate('/inventory');
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setDetectedPoi(null);
  };

  const handleUnplacedAssetsCreated = () => {
    setSavedCount(prev => prev + 1);
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
          
          <div className="flex items-center gap-3">
            {savedCount > 0 && (
              <div className="text-sm text-muted-foreground bg-primary/10 px-2 py-1 rounded">
                {savedCount} sparade
              </div>
            )}
            
            {/* Button to create POIs from existing assets */}
            {!unplacedPanelOpen && ivionUrl && (
              <Button 
                variant="outline" 
                onClick={() => setUnplacedPanelOpen(true)} 
                className="gap-2"
              >
                <Layers className="h-4 w-4" />
                <span className="hidden md:inline">Skapa POI från Geminus</span>
                <span className="md:hidden">POI</span>
              </Button>
            )}
            
            {/* Registration button in header */}
            {!formOpen && ivionUrl && (
              <Button onClick={() => setFormOpen(true)} className="gap-2">
                <Camera className="h-4 w-4" />
                <span className="hidden md:inline">Registrera tillgång</span>
                <span className="md:hidden">Registrera</span>
              </Button>
            )}
          </div>
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

      {/* Floating registration form */}
      {formOpen && (
        <IvionRegistrationPanel
          buildingFmGuid={selectedBuildingFmGuid}
          ivionSiteId={currentIvionSiteId}
          onClose={handleFormClose}
          onSaved={handleAssetSaved}
          onSavedAndClose={handleAssetSavedAndClose}
          initialPoi={detectedPoi}
        />
      )}

      {/* Unplaced assets panel */}
      {unplacedPanelOpen && (
        <UnplacedAssetsPanel
          buildingFmGuid={selectedBuildingFmGuid}
          ivionSiteId={currentIvionSiteId}
          onClose={() => setUnplacedPanelOpen(false)}
          onAssetsCreated={handleUnplacedAssetsCreated}
        />
      )}
    </div>
  );
};

export default IvionInventory;
