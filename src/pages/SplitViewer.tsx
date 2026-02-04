import React, { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Link2, Link2Off, RotateCcw, Maximize2, Minimize2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { AppContext } from '@/context/AppContext';
import { ViewerSyncProvider, useViewerSync, LocalCoords } from '@/context/ViewerSyncContext';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import Ivion360View from '@/components/viewer/Ivion360View';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { BuildingOrigin } from '@/lib/coordinate-transform';
import { cn } from '@/lib/utils';

const IVION_FALLBACK_URL = 'https://swg.iv.navvis.com';

interface BuildingData {
  fmGuid: string;
  name: string;
  ivionSiteId: string;
  origin: BuildingOrigin | null;
}

interface SplitViewerContentProps {
  buildingData: BuildingData;
}

const SplitViewerContent: React.FC<SplitViewerContentProps> = ({
  buildingData,
}) => {
  const navigate = useNavigate();
  const { appConfigs } = useContext(AppContext);
  const { syncLocked, setSyncLocked, resetSync, syncState, updateFrom3D, updateFromIvion, setBuildingContext } = useViewerSync();
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Manual sync fallback state
  const [showManualSyncDialog, setShowManualSyncDialog] = useState(false);
  const [manualIvionUrl, setManualIvionUrl] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Sync position state - transformed coordinates for each viewer
  const [sync3DPosition, setSync3DPosition] = useState<LocalCoords | null>(null);
  const [sync3DHeading, setSync3DHeading] = useState<number>(0);
  const [sync3DPitch, setSync3DPitch] = useState<number>(0);

  // Set building context for coordinate transformation
  useEffect(() => {
    setBuildingContext({
      fmGuid: buildingData.fmGuid,
      originLat: buildingData.origin?.lat,
      originLng: buildingData.origin?.lng,
      rotation: buildingData.origin?.rotation,
    });
  }, [buildingData, setBuildingContext]);

  // Construct Ivion URL using config (same pattern as IvionInventory)
  const configured = appConfigs?.radar?.url?.trim();
  const baseUrl = configured ? configured.replace(/\/$/, '') : IVION_FALLBACK_URL;
  const ivionUrl = `${baseUrl}/?site=${buildingData.ivionSiteId}`;

  console.log('[SplitViewer] Ivion URL:', ivionUrl);
  console.log('[SplitViewer] Building origin:', buildingData.origin);

  // Handle camera change from 3D viewer
  const handle3DCameraChange = useCallback((position: LocalCoords, heading: number, pitch: number) => {
    if (!syncLocked) return;
    
    // Update sync context - Ivion360View will react via useIvionCameraSync
    updateFrom3D(position, heading, pitch);
  }, [syncLocked, updateFrom3D]);

  // React to sync state changes from Ivion and update 3D viewer position
  useEffect(() => {
    if (!syncLocked) return;
    if (syncState.source !== 'ivion' || !syncState.position) return;
    
    // Set position for 3D viewer
    setSync3DPosition(syncState.position);
    setSync3DHeading(syncState.heading);
    setSync3DPitch(syncState.pitch);
  }, [syncLocked, syncState]);

  // Handle manual sync from Ivion URL
  const handleParseManualUrl = useCallback(async () => {
    if (!manualIvionUrl.includes('image=')) {
      toast.error('URL:en måste innehålla &image=XXX');
      return;
    }
    
    setIsSyncing(true);
    try {
      const url = new URL(manualIvionUrl);
      const imageId = url.searchParams.get('image');
      
      if (!imageId) {
        toast.error('Kunde inte hitta image-parameter i URL:en');
        return;
      }
      
      // Parse view angles from URL
      const vlon = parseFloat(url.searchParams.get('vlon') || '0');
      const vlat = parseFloat(url.searchParams.get('vlat') || '0');
      
      // Convert radians to degrees
      const heading = (vlon * 180) / Math.PI;
      const pitch = (vlat * 180) / Math.PI;
      
      // Fetch image position from API
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-image-position',
          imageId: parseInt(imageId, 10),
          buildingFmGuid: buildingData.fmGuid,
        },
      });
      
      if (error || !data?.success) {
        toast.error('Kunde inte hämta bildposition', {
          description: data?.error || 'Kontrollera Ivion-konfigurationen'
        });
        return;
      }
      
      const position: LocalCoords = {
        x: data.location.x,
        y: data.location.y,
        z: data.location.z,
      };
      
      console.log('[SplitViewer] Manual sync from URL:', { imageId, position, heading, pitch });
      
      // Update 3D viewer
      updateFromIvion(position, heading, pitch);
      setSync3DPosition(position);
      setSync3DHeading(heading);
      setSync3DPitch(pitch);
      
      toast.success('3D-vy synkad från 360°');
      setShowManualSyncDialog(false);
      setManualIvionUrl('');
    } catch (err) {
      console.error('[SplitViewer] Failed to parse URL:', err);
      toast.error('Ogiltig URL');
    } finally {
      setIsSyncing(false);
    }
  }, [manualIvionUrl, buildingData.fmGuid, updateFromIvion]);

  const handleBack = () => {
    // Use explicit path to avoid iframe history conflicts
    navigate('/');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Tillbaka</span>
          </Button>
          <div className="h-5 w-px bg-border" />
          <div>
            <h1 className="text-sm font-semibold">{buildingData.name}</h1>
            <p className="text-xs text-muted-foreground">3D + 360° Synkroniserad vy</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Sync status indicator */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1 bg-muted/50 rounded">
            <span className={cn(
              "h-2 w-2 rounded-full transition-colors",
              syncState.source === 'ivion' ? "bg-primary" :
              syncState.source === '3d' ? "bg-accent-foreground" : "bg-muted-foreground/50"
            )} />
            <span className="hidden sm:inline">
              {syncState.source === 'ivion' ? '360° → 3D' :
               syncState.source === '3d' ? '3D → 360°' : 'Väntar...'}
            </span>
          </div>

          {/* Sync toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={syncLocked ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSyncLocked(!syncLocked)}
                className="gap-1.5"
              >
                {syncLocked ? (
                  <>
                    <Link2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Sync ON</span>
                  </>
                ) : (
                  <>
                    <Link2Off className="h-4 w-4" />
                    <span className="hidden sm:inline">Sync OFF</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {syncLocked
                ? 'Vyerna följer varandra automatiskt. Klicka för att låsa upp.'
                : 'Vyerna är oberoende. Klicka för att synkronisera.'}
            </TooltipContent>
          </Tooltip>

          {/* Manual sync button (fallback) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setShowManualSyncDialog(true)}
                title="Synka manuellt från 360°-URL"
              >
                <Upload className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Synka manuellt från 360°-URL</TooltipContent>
          </Tooltip>

          {/* Reset button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={resetSync}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Återställ synk</TooltipContent>
          </Tooltip>

          {/* Fullscreen toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggleFullscreen}>
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isFullscreen ? 'Avsluta fullskärm' : 'Fullskärm'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Split panels */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* 3D Viewer Panel */}
        <ResizablePanel defaultSize={50} minSize={25}>
          <div className="h-full relative">
            <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium">
              3D Model
            </div>
            <AssetPlusViewer 
              fmGuid={buildingData.fmGuid}
              syncEnabled={syncLocked}
              onCameraChange={handle3DCameraChange}
              syncPosition={sync3DPosition}
              syncHeading={sync3DHeading}
              syncPitch={sync3DPitch}
            />
          </div>
        </ResizablePanel>

        {/* Resize handle */}
        <ResizableHandle withHandle />

        {/* 360° Viewer Panel */}
        <ResizablePanel defaultSize={50} minSize={25}>
          <div className="h-full relative">
            <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium">
              360° View
            </div>
            <Ivion360View 
              url={ivionUrl} 
              syncEnabled={syncLocked}
              buildingOrigin={buildingData.origin}
              buildingFmGuid={buildingData.fmGuid}
              ivionSiteIdProp={buildingData.ivionSiteId}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Manual sync fallback dialog */}
      <Dialog open={showManualSyncDialog} onOpenChange={setShowManualSyncDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Synka från 360°</DialogTitle>
            <DialogDescription>
              Klistra in en 360°-länk för att synka 3D-vyn till samma position.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ol className="list-decimal list-inside text-sm space-y-2 text-muted-foreground">
              <li>I 360°-vyn, klicka på <strong className="text-foreground">Dela</strong>-ikonen (📤)</li>
              <li>Kopiera länken som visas</li>
              <li>Klistra in den nedan</li>
            </ol>
            <Input
              value={manualIvionUrl}
              onChange={(e) => setManualIvionUrl(e.target.value)}
              placeholder="https://swg.iv.navvis.com/?site=...&image=..."
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              URL:en måste innehålla <code className="bg-muted px-1 rounded">&image=XXX</code>
            </p>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowManualSyncDialog(false);
                setManualIvionUrl('');
              }}
            >
              Avbryt
            </Button>
            <Button 
              onClick={handleParseManualUrl} 
              disabled={!manualIvionUrl.includes('image=') || isSyncing}
            >
              {isSyncing ? 'Synkar...' : 'Synka'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/**
 * Split Viewer Page
 * 
 * Displays 3D model and 360° panorama side-by-side with automatic bi-directional synchronization.
 * Accessed via URL: /split-viewer?building=<fmGuid>
 */
const SplitViewer: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { allData } = useContext(AppContext);
  
  const [buildingData, setBuildingData] = useState<BuildingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buildingFmGuid = searchParams.get('building');

  // Fetch building data and Ivion site ID
  useEffect(() => {
    const loadBuilding = async () => {
      if (!buildingFmGuid) {
        setError('Ingen byggnad angiven');
        setIsLoading(false);
        return;
      }

      // Find building in allData
      const building = allData.find(
        (item: any) =>
          item.fmGuid === buildingFmGuid &&
          (item.category === 'Building' || item.category === 'IfcBuilding')
      );

      if (!building) {
        setError('Byggnaden kunde inte hittas');
        setIsLoading(false);
        return;
      }

      // Fetch building settings to get Ivion site ID and coordinates
      try {
        const { data: settings, error: settingsError } = await supabase
          .from('building_settings')
          .select('ivion_site_id, latitude, longitude, rotation')
          .eq('fm_guid', buildingFmGuid)
          .maybeSingle();

        if (settingsError) {
          console.error('Error fetching building settings:', settingsError);
        }

        if (!settings?.ivion_site_id) {
          setError('360°-vy är inte konfigurerad för denna byggnad. Konfigurera Ivion Site ID i byggnadsinställningarna.');
          setIsLoading(false);
          return;
        }

        // Build origin for coordinate transformation
        const origin: BuildingOrigin | null = 
          settings.latitude && settings.longitude
            ? {
                lat: settings.latitude,
                lng: settings.longitude,
                rotation: (settings as any).rotation ?? 0,
              }
            : null;

        setBuildingData({
          fmGuid: buildingFmGuid,
          name: building.commonName || building.name || 'Byggnad',
          ivionSiteId: settings.ivion_site_id,
          origin,
        });
      } catch (err) {
        console.error('Error loading building data:', err);
        setError('Kunde inte ladda byggnadsdata');
      }

      setIsLoading(false);
    };

    if (allData.length > 0) {
      loadBuilding();
    }
  }, [buildingFmGuid, allData]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Laddar Split View...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <p className="text-destructive font-medium mb-2">⚠️ {error}</p>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Tillbaka
          </Button>
        </div>
      </div>
    );
  }

  if (!buildingData) {
    return null;
  }

  return (
    <ViewerSyncProvider
      initialBuildingContext={{
        fmGuid: buildingData.fmGuid,
        originLat: buildingData.origin?.lat,
        originLng: buildingData.origin?.lng,
        rotation: buildingData.origin?.rotation ?? 0,
      }}
    >
      <SplitViewerContent buildingData={buildingData} />
    </ViewerSyncProvider>
  );
};

export default SplitViewer;
