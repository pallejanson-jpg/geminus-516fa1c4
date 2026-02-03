import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Link2, Link2Off, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { AppContext } from '@/context/AppContext';
import { ViewerSyncProvider, useViewerSync } from '@/context/ViewerSyncContext';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import Ivion360View from '@/components/viewer/Ivion360View';
import { supabase } from '@/integrations/supabase/client';

const IVION_FALLBACK_URL = 'https://swg.iv.navvis.com';

interface SplitViewerContentProps {
  buildingFmGuid: string;
  buildingName: string;
  ivionSiteId: string;
}

const SplitViewerContent: React.FC<SplitViewerContentProps> = ({
  buildingFmGuid,
  buildingName,
  ivionSiteId,
}) => {
  const navigate = useNavigate();
  const { appConfigs } = useContext(AppContext);
  const { syncLocked, setSyncLocked, syncState, resetSync } = useViewerSync();
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Construct Ivion URL using config (same pattern as IvionInventory)
  const configured = appConfigs?.radar?.url?.trim();
  const baseUrl = configured ? configured.replace(/\/$/, '') : IVION_FALLBACK_URL;
  const ivionUrl = `${baseUrl}/?site=${ivionSiteId}`;

  console.log('[SplitViewer] Ivion URL:', ivionUrl);

  // Handle sync state changes - this is where the magic happens
  useEffect(() => {
    if (!syncLocked || !syncState.source || !syncState.position) return;

    // The receiving viewer will handle navigation based on syncState
    // This is done via props/context in the individual viewer components
    console.log('Sync state changed:', syncState.source, syncState.position);
  }, [syncLocked, syncState]);

  const handleBack = () => {
    navigate(-1);
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
            <h1 className="text-sm font-semibold">{buildingName}</h1>
            <p className="text-xs text-muted-foreground">3D + 360° Synkroniserad vy</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
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
                ? 'Vyerna följer varandra. Klicka för att låsa upp.'
                : 'Vyerna är oberoende. Klicka för att synkronisera.'}
            </TooltipContent>
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
              fmGuid={buildingFmGuid} 
              // Note: sync callbacks will be added in a future iteration
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
            <Ivion360View url={ivionUrl} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

/**
 * Split Viewer Page
 * 
 * Displays 3D model and 360° panorama side-by-side with optional synchronization.
 * Accessed via URL: /split-viewer?building=<fmGuid>
 */
const SplitViewer: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { allData } = useContext(AppContext);
  
  const [buildingData, setBuildingData] = useState<{
    fmGuid: string;
    name: string;
    ivionSiteId: string;
  } | null>(null);
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

      // Fetch building settings to get Ivion site ID
      try {
        const { data: settings, error: settingsError } = await supabase
          .from('building_settings')
          .select('ivion_site_id')
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

        setBuildingData({
          fmGuid: buildingFmGuid,
          name: building.commonName || building.name || 'Byggnad',
          ivionSiteId: settings.ivion_site_id,
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
      }}
    >
      <SplitViewerContent
        buildingFmGuid={buildingData.fmGuid}
        buildingName={buildingData.name}
        ivionSiteId={buildingData.ivionSiteId}
      />
    </ViewerSyncProvider>
  );
};

export default SplitViewer;
