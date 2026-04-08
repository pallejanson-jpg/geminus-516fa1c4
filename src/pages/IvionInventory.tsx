import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Building2, Loader2, Camera, Layers, Wifi, WifiOff, AlertCircle, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';

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

type ConnectionStatus = 'unknown' | 'connected' | 'error' | 'expired';

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

  // POI polling state - IMPROVED
  const [lastSeenPoiId, setLastSeenPoiId] = useState<number | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [detectedPoi, setDetectedPoi] = useState<IvionPoiData | null>(null);
  const [pendingPoi, setPendingPoi] = useState<IvionPoiData | null>(null); // NEW: POI waiting while form is open
  const pollingIntervalRef = useRef<number | null>(null);

  // Connection status - NEW
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null);

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
    const baseUrl = IVION_DEFAULT_BASE_URL;
    setIvionUrl(`${baseUrl}/?site=${building.ivion_site_id}`);
    
    // Reset connection status when building changes
    setConnectionStatus('unknown');
    setLastSeenPoiId(null);
  }, [selectedBuildingFmGuid, buildings]);

  // Get the current ivion site id
  const currentIvionSiteId = buildings.find(b => b.fm_guid === selectedBuildingFmGuid)?.ivion_site_id || null;

  // Test API connection
  const testConnection = useCallback(async () => {
    if (!currentIvionSiteId) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-latest-poi',
          siteId: currentIvionSiteId,
        },
      });

      if (error) {
        setConnectionStatus('error');
        setConnectionError(error.message || 'API-fel');
        return false;
      }

      if (data?.error) {
        // Check for auth-related errors
        if (data.error.includes('401') || data.error.includes('token') || data.error.includes('auth')) {
          setConnectionStatus('expired');
          setConnectionError('Access token har gått ut');
        } else {
          setConnectionStatus('error');
          setConnectionError(data.error);
        }
        return false;
      }

      setConnectionStatus('connected');
      setConnectionError(null);
      return true;
    } catch (err: any) {
      setConnectionStatus('error');
      setConnectionError(err.message || 'Kunde inte ansluta');
      return false;
    }
  }, [currentIvionSiteId]);

  // POI Polling - IMPROVED: continues even when form is open
  useEffect(() => {
    if (!currentIvionSiteId || !pollingEnabled) {
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

        setLastPollTime(new Date());

        // Handle errors
        if (error || data?.error) {
          if (data?.error?.includes('401') || data?.error?.includes('token')) {
            setConnectionStatus('expired');
            setConnectionError('Access token har gått ut');
          } else if (connectionStatus === 'connected') {
            // Only show error if we were previously connected
            setConnectionStatus('error');
            setConnectionError(data?.error || error?.message || 'Polling misslyckades');
          }
          return;
        }

        // Update connection status
        if (connectionStatus !== 'connected') {
          setConnectionStatus('connected');
          setConnectionError(null);
        }

        // Check if we got a valid POI
        if (data?.id && data?.location) {
          // If this is a new POI (different from last seen)
          if (data.id !== lastSeenPoiId) {
            console.log('New POI detected:', data.id, 'previous:', lastSeenPoiId);
            
            if (lastSeenPoiId !== null) {
              // This is a genuinely new POI (not the first poll)
              if (formOpen) {
                // Form is open - queue the POI and notify user
                setPendingPoi(data);
                toast.info('New POI detected!', {
                  description: 'Click "Load new POI" to use it',
                  duration: 5000,
                });
              } else {
                // Form is closed - open it with the new POI
                setDetectedPoi(data);
                setFormOpen(true);
              }
            }
            
            setLastSeenPoiId(data.id);
          }
        }
      } catch (err) {
        // Silent fail - polling is a background feature
        console.log('POI polling error (non-critical):', err);
      }
    };

    // Initial poll to establish baseline and test connection
    pollForNewPois();

    // Poll every 3 seconds
    pollingIntervalRef.current = window.setInterval(pollForNewPois, 3000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [currentIvionSiteId, pollingEnabled, lastSeenPoiId, formOpen, connectionStatus]);

  // Handle loading pending POI into form
  const handleLoadPendingPoi = () => {
    if (pendingPoi) {
      setDetectedPoi(pendingPoi);
      setPendingPoi(null);
    }
  };

  const handleAssetSaved = () => {
    setSavedCount(prev => prev + 1);
    setDetectedPoi(null);
    // Check if there's a pending POI to load
    if (pendingPoi) {
      toast.info('There is a pending POI', {
        description: 'Click "Load new POI" to register it',
      });
    }
  };

  const handleAssetSavedAndClose = () => {
    setSavedCount(prev => prev + 1);
    setFormOpen(false);
    setDetectedPoi(null);
    setPendingPoi(null);
    navigate('/inventory');
  };

  const handleClose = () => {
    navigate('/inventory');
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setDetectedPoi(null);
    // Don't clear pending POI - user might want to open form again
  };

  const handleUnplacedAssetsCreated = () => {
    setSavedCount(prev => prev + 1);
  };

  // Connection status indicator component
  const ConnectionIndicator = () => {
    const getStatusColor = () => {
      switch (connectionStatus) {
        case 'connected': return 'bg-green-500';
        case 'error': return 'bg-red-500';
        case 'expired': return 'bg-amber-500';
        default: return 'bg-muted-foreground';
      }
    };

    const getStatusIcon = () => {
      switch (connectionStatus) {
        case 'connected': return <Wifi className="h-3.5 w-3.5" />;
        case 'error': return <WifiOff className="h-3.5 w-3.5" />;
        case 'expired': return <AlertCircle className="h-3.5 w-3.5" />;
        default: return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
      }
    };

    const getStatusText = () => {
      switch (connectionStatus) {
        case 'connected': return 'Connected';
        case 'error': return 'Connection error';
        case 'expired': return 'Token expired';
        default: return 'Connecting...';
      }
    };

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs",
              connectionStatus === 'connected' ? 'text-green-600 bg-green-100/80 dark:bg-green-900/30' :
              connectionStatus === 'error' ? 'text-red-600 bg-red-100/80 dark:bg-red-900/30' :
              connectionStatus === 'expired' ? 'text-amber-600 bg-amber-100/80 dark:bg-amber-900/30' :
              'text-muted-foreground bg-muted'
            )}>
              <span className={cn("h-2 w-2 rounded-full animate-pulse", getStatusColor())} />
              {getStatusIcon()}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-sm">
              <p className="font-medium">{getStatusText()}</p>
              {connectionError && <p className="text-xs text-muted-foreground mt-1">{connectionError}</p>}
              {lastPollTime && connectionStatus === 'connected' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last poll: {lastPollTime.toLocaleTimeString('en-US')}
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading 360° inventory...</p>
        </div>
      </div>
    );
  }

  if (buildings.length === 0) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md text-center space-y-4">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">No Ivion 360° configured</h2>
          <p className="text-muted-foreground">
            To use 360° inventory, at least one building must have an Ivion Site ID configured.
          </p>
          <Button onClick={handleClose}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
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
                  <SelectValue placeholder="Select building..." />
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
            
            {/* Connection status indicator */}
            {ivionUrl && <ConnectionIndicator />}
          </div>
          
          <div className="flex items-center gap-3">
            {savedCount > 0 && (
              <div className="text-sm text-muted-foreground bg-primary/10 px-2 py-1 rounded">
                {savedCount} saved
              </div>
            )}
            
            {/* Pending POI notification */}
            {pendingPoi && formOpen && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleLoadPendingPoi}
                className="gap-2 border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden md:inline">Load New POI</span>
                <Badge variant="secondary" className="ml-1 bg-amber-100 text-amber-700">1</Badge>
              </Button>
            )}
            
            {/* Button to create POIs from existing assets */}
            {!unplacedPanelOpen && ivionUrl && (
              <Button 
                variant="outline" 
                onClick={() => setUnplacedPanelOpen(true)} 
                className="gap-2"
              >
                <Layers className="h-4 w-4" />
                <span className="hidden md:inline">Create POI from Geminus</span>
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
        
        {/* Instruction banner */}
        {ivionUrl && !formOpen && (
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/50 border-t border-blue-100 dark:border-blue-900 flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              <strong>Arbetsflöde:</strong> Skapa en POI i Ivions 360°-vy (använd +) → Registreringsformuläret öppnas automatiskt
            </span>
          </div>
        )}
        
        {/* Connection error banner */}
        {connectionStatus === 'expired' && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-t border-amber-100 dark:border-amber-900 flex items-center justify-between text-sm text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Ivion access token har gått ut. POI-detektion fungerar inte automatiskt.</span>
            </div>
            <Button variant="outline" size="sm" onClick={testConnection} className="shrink-0">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Försök igen
            </Button>
          </div>
        )}
      </div>

      {/* Fullscreen Ivion iframe */}
      {ivionUrl ? (
        <iframe
          src={ivionUrl}
          className={cn(
            "w-full h-full border-0",
            // Adjust padding based on whether banners are shown
            !formOpen && connectionStatus !== 'expired' ? 'pt-[104px]' :
            connectionStatus === 'expired' ? 'pt-[144px]' :
            'pt-14'
          )}
          allow="fullscreen; accelerometer; gyroscope"
          title="Ivion 360° View"
        />
      ) : (
        <div className="h-full flex items-center justify-center pt-14">
          <div className="text-center space-y-4">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">
              Select a building to open the 360° view
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
          connectionStatus={connectionStatus}
          onLoadPendingPoi={pendingPoi ? handleLoadPendingPoi : undefined}
          hasPendingPoi={!!pendingPoi}
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
