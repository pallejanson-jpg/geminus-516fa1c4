import React, { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { Box, Maximize2, RotateCcw, ZoomIn, ZoomOut, Layers, Loader2, AlertCircle, X, Filter, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AssetPlusViewerProps {
  fmGuid: string;
  onClose?: () => void;
}

interface ViewerState {
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  modelInfo: {
    name?: string;
    type?: string;
    objectCount?: number;
    lastUpdated?: string;
  } | null;
}

type ModelFilter = 'all' | 'a-prefix' | 'buildings-only';

const MODEL_FILTERS: { value: ModelFilter; label: string; description: string }[] = [
  { value: 'all', label: 'Alla modeller', description: 'Visa alla tillgängliga modeller' },
  { value: 'a-prefix', label: 'Modeller (a-prefix)', description: 'Modeller som börjar med "a"' },
  { value: 'buildings-only', label: 'Endast byggnader', description: 'Visa endast byggnadsmodeller' },
];

/**
 * Asset+ 3D Viewer Component
 * 
 * Integrates with the Asset+ 3D Viewer package to display BIM models.
 * Based on Asset+ external_viewer.html implementation pattern.
 */
const AssetPlusViewer: React.FC<AssetPlusViewerProps> = ({ fmGuid, onClose }) => {
  const { allData } = useContext(AppContext);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewerInstanceRef = useRef<any>(null);
  const accessTokenRef = useRef<string>('');
  
  // Deferred loading state (matching Asset+ pattern)
  const deferCallsRef = useRef(true);
  const deferredFmGuidRef = useRef<string | null>(null);
  const deferredDisplayActionRef = useRef<any>(null);
  const deferredFmGuidForDisplayRef = useRef<string | null>(null);
  const deferredDisplayActionForDisplayRef = useRef<any>(null);
  
  const [state, setState] = useState<ViewerState>({
    isLoading: true,
    isInitialized: false,
    error: null,
    modelInfo: null,
  });
  
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');

  // Find the asset data for the given fmGuid
  const assetData = allData.find((a: any) => a.fmGuid === fmGuid);

  // Get model filter predicate based on selection
  const getModelPredicate = useCallback((filter: ModelFilter) => {
    switch (filter) {
      case 'a-prefix':
        return (model: any) => (model?.name || "").toLowerCase().startsWith("a");
      case 'buildings-only':
        return (model: any) => {
          const name = (model?.name || "").toLowerCase();
          return name.includes("building") || name.includes("byggnad");
        };
      case 'all':
      default:
        return () => true;
    }
  }, []);

  // Execute display action (from Asset+ pattern)
  const executeDisplayAction = useCallback((displayAction: any) => {
    const viewer = viewerInstanceRef.current;
    if (!viewer) return;

    switch (displayAction?.action?.toLowerCase()) {
      case "cutoutfloor":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          console.log("Cutting out floor with FMGUID", displayAction.parameter.fmGuid);
          viewer.cutOutFloorsByFmGuid(displayAction.parameter.fmGuid, displayAction.parameter.includeRelatedFloors);
        }
        break;
      case "viewall":
        console.log("Viewing all and adjusting camera.");
        viewer.assetViewer?.$refs?.assetView?.viewFit(undefined, true);
        break;
      case "viewfitfirstperson":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          const matches = viewer.assetViewer?.$refs?.assetView?.getItemsByPropertyValue("fmguid", displayAction.parameter.fmGuid.toUpperCase());
          if (matches?.length > 0) {
            console.log("ViewFit (First Person Mode) FMGUID", displayAction.parameter.fmGuid);
            viewer.assetViewer.$refs.assetView.viewFit(matches, false);
            viewer.assetViewer.$refs.assetView.setNavMode("firstPerson");
          }
        }
        break;
    }
  }, []);

  // Do display FMGUID (from Asset+ pattern)
  const doDisplayFmGuid = useCallback((fmGuidToShow: string, displayAction?: any) => {
    const viewer = viewerInstanceRef.current;
    if (!viewer) return;

    console.log("doDisplayFmGuid:", fmGuidToShow);

    deferredFmGuidForDisplayRef.current = fmGuidToShow;
    deferredDisplayActionForDisplayRef.current = displayAction;

    viewer.setObjectDetailsVisibility(false);
    viewer.setAvailableModelsByFmGuid(fmGuidToShow);
  }, []);

  // Display FMGUID with deferred handling
  const displayFmGuid = useCallback((fmGuidToShow: string, displayAction?: any) => {
    deferredFmGuidRef.current = undefined;
    deferredDisplayActionRef.current = undefined;

    if (!deferCallsRef.current) {
      console.log("displayFmGuid: Not deferring, showing immediately");
      doDisplayFmGuid(fmGuidToShow, displayAction);
    } else {
      console.log("displayFmGuid: Deferring, will show later");
      if (fmGuidToShow) {
        deferredFmGuidRef.current = fmGuidToShow;
      }
      if (displayAction) {
        deferredDisplayActionRef.current = displayAction;
      }
    }
  }, [doDisplayFmGuid]);

  // Process deferred calls (from Asset+ pattern)
  const processDeferred = useCallback(() => {
    if (deferredFmGuidRef.current) {
      const fmGuidToShow = deferredFmGuidRef.current;
      const displayAction = deferredDisplayActionRef.current;

      deferredFmGuidRef.current = null;
      deferredDisplayActionRef.current = null;

      doDisplayFmGuid(fmGuidToShow, displayAction);
    }
  }, [doDisplayFmGuid]);

  // Fetch access token and initialize viewer
  const initializeViewer = useCallback(async () => {
    if (!viewerContainerRef.current) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Fetch Asset+ access token via edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('asset-plus-query', {
        body: { action: 'getToken' }
      });

      if (tokenError) {
        throw new Error('Kunde inte hämta åtkomsttoken');
      }

      const accessToken = tokenData?.accessToken;
      
      if (!accessToken) {
        throw new Error('Asset+ åtkomsttoken saknas. Kontrollera API-inställningarna.');
      }

      accessTokenRef.current = accessToken;

      // Check if assetplusviewer is available globally
      const assetplusviewer = (window as any).assetplusviewer;
      
      if (!assetplusviewer) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Asset+ 3D Viewer-paketet är inte laddat. Paketet behöver inkluderas i projektet.',
        }));
        return;
      }

      // Get API configuration
      const { data: configData } = await supabase.functions.invoke('asset-plus-query', {
        body: { action: 'getConfig' }
      });

      const baseUrl = configData?.apiUrl || '';
      const apiKey = configData?.apiKey || '';

      console.log("AssetPlusViewer: Init - Calling assetplusviewer");

      // Initialize the viewer following exact Asset+ external_viewer.html pattern
      const viewer = await assetplusviewer(
        baseUrl,  // URL to the API Backend
        apiKey,   // API Key in UUID format
        // getAccessTokenCallback
        async () => {
          console.log("getAccessTokenCallback");
          return accessTokenRef.current;
        },
        // selectionChangedCallback
        (items: any[], added: any[], removed: any[]) => {
          console.log("selectionChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
        },
        // selectedFmGuidsChangedCallback
        (items: string[], added: string[], removed: string[]) => {
          console.log("selectedFmGuidsChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
        },
        // allModelsLoadedCallback
        () => {
          console.log("allModelsLoadedCallback");

          if (deferredFmGuidForDisplayRef.current) {
            console.log("allModelsLoadedCallback - got an FMGUID to look at");
            const fmGuidToShow = deferredFmGuidForDisplayRef.current;
            const displayAction = deferredDisplayActionForDisplayRef.current;

            deferredFmGuidForDisplayRef.current = null;
            deferredDisplayActionForDisplayRef.current = null;

            // If we're not cutting the floor, then select + viewfit (zoom)
            if (!displayAction) {
              console.log("allModelsLoadedCallback - just select + zoom");
              viewerInstanceRef.current?.selectFmGuidAndViewFit(fmGuidToShow);
            } else {
              console.log("allModelsLoadedCallback - display action + select");
              executeDisplayAction(displayAction);
              viewerInstanceRef.current?.selectFmGuid(fmGuidToShow);
            }
          }

          toast.success('3D-modell laddad');
        },
        // isItemIdEditableCallback (for BimObjectId instead of FmGuid)
        undefined,
        // isFmGuidEditableCallback
        async (fmGuidParam: string) => {
          console.log("isFmGuidEditableCallback - fmGuid:", fmGuidParam);
          return false; // Read-only for now
        },
        // additionalDefaultPredicate - model filter
        getModelPredicate(modelFilter),
        // Custom object context menu items
        [],
        // Horizontal and vertical default angles (undefined for defaults)
        undefined, undefined,
        // Annotation offsets (top, left) (undefined for defaults)
        undefined, undefined
      );

      viewerInstanceRef.current = viewer;
      console.log("AssetPlusViewer: Mounted");

      // Stop deferring calls
      deferCallsRef.current = false;

      // Process any deferred calls
      processDeferred();

      // Display the initial FMGUID with viewall action for buildings
      const displayAction = assetData?.category === 'Building' 
        ? { action: 'viewall' }
        : undefined;
      
      displayFmGuid(fmGuid, displayAction);

      setState(prev => ({
        ...prev,
        isLoading: false,
        isInitialized: true,
        modelInfo: {
          name: assetData?.commonName || assetData?.name || 'Okänd modell',
          type: 'IFC/XKT',
          lastUpdated: assetData?.sourceUpdatedAt || new Date().toISOString().split('T')[0],
        },
      }));

    } catch (error) {
      console.error('Failed to initialize 3D viewer:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Kunde inte ladda 3D-visaren',
      }));
    }
  }, [fmGuid, assetData, modelFilter, getModelPredicate, executeDisplayAction, processDeferred, displayFmGuid]);

  // Initialize on mount
  useEffect(() => {
    initializeViewer();

    return () => {
      // Cleanup viewer on unmount
      if (viewerInstanceRef.current?.clearData) {
        viewerInstanceRef.current.clearData();
      }
      deferCallsRef.current = true;
    };
  }, [initializeViewer]);

  // Viewer control handlers
  const handleZoomIn = () => {
    viewerInstanceRef.current?.assetViewer?.$refs?.assetView?.onCommand?.('zoomIn');
  };

  const handleZoomOut = () => {
    viewerInstanceRef.current?.assetViewer?.$refs?.assetView?.onCommand?.('zoomOut');
  };

  const handleResetView = () => {
    viewerInstanceRef.current?.assetViewer?.$refs?.assetView?.viewFit?.(undefined, true);
  };

  const handleFullscreen = () => {
    if (viewerContainerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        viewerContainerRef.current.requestFullscreen();
      }
    }
  };

  const handleFilterChange = (filter: ModelFilter) => {
    setModelFilter(filter);
    // Reinitialize viewer with new filter
    if (viewerInstanceRef.current?.clearData) {
      viewerInstanceRef.current.clearData();
    }
    deferCallsRef.current = true;
    setState(prev => ({ ...prev, isInitialized: false }));
  };

  // Show loading state
  if (state.isLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-muted rounded-lg">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div>
              <p className="text-lg font-medium">Laddar 3D-modell...</p>
              <p className="text-sm text-muted-foreground">FMGUID: {fmGuid.substring(0, 8)}...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Model filter dropdown
  const FilterDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">
            {MODEL_FILTERS.find(f => f.value === modelFilter)?.label || 'Filter'}
          </span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {MODEL_FILTERS.map((filter) => (
          <DropdownMenuItem
            key={filter.value}
            onClick={() => handleFilterChange(filter.value)}
            className={modelFilter === filter.value ? 'bg-accent' : ''}
          >
            <div>
              <div className="font-medium">{filter.label}</div>
              <div className="text-xs text-muted-foreground">{filter.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Common viewer container with dx classes
  const ViewerContainer = ({ children, showPlaceholder = false }: { children?: React.ReactNode; showPlaceholder?: boolean }) => (
    <div 
      ref={viewerContainerRef}
      id="AssetPlusViewer"
      className="relative w-full h-full min-h-[300px] md:min-h-[400px] rounded-lg overflow-hidden dx-device-desktop dx-device-generic dx-theme-material dx-theme-material-typography"
      style={{
        background: 'radial-gradient(90% 100% at center top, rgb(236, 236, 236), rgb(42, 42, 50))',
      }}
    >
      {showPlaceholder && children}
      
      {/* Viewer Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 sm:gap-2 bg-background/90 backdrop-blur-sm rounded-lg p-1.5 sm:p-2 border z-10">
        <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={handleZoomIn}>
          <ZoomIn className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={handleZoomOut}>
          <ZoomOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
        <div className="w-px h-5 sm:h-6 bg-border" />
        <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={handleResetView}>
          <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={handleFullscreen}>
          <Maximize2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </Button>
      </div>

      {/* Filter & Layer Toggle */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <FilterDropdown />
        <Button variant="secondary" size="sm" className="gap-2">
          <Layers className="h-4 w-4" />
          <span className="hidden sm:inline">Lager</span>
        </Button>
      </div>
    </div>
  );

  // Show error state with placeholder
  if (state.error || !state.isInitialized) {
    return (
      <div className="h-full flex flex-col p-2 sm:p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg sm:text-xl font-semibold truncate">3D-visning</h2>
            <p className="text-sm text-muted-foreground truncate">
              {assetData?.commonName || assetData?.name || fmGuid.substring(0, 16) + '...'}
            </p>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0 ml-2">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Viewer area */}
        <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-6 min-h-0">
          <Card className="flex-1 lg:flex-[3] min-h-0">
            <CardContent className="p-0 h-full">
              <ViewerContainer showPlaceholder>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center space-y-4 max-w-md px-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
                      {state.error ? (
                        <AlertCircle className="h-8 w-8 text-destructive" />
                      ) : (
                        <Box className="h-8 w-8 text-primary" />
                      )}
                    </div>
                    <div>
                      <p className="text-lg font-medium text-foreground">
                        {state.error ? 'Kunde inte ladda 3D-visaren' : '3D-visare'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {state.error || 'Asset+ 3D Viewer kommer att visas här'}
                      </p>
                    </div>
                    {state.error && (
                      <Button onClick={initializeViewer} variant="outline" size="sm">
                        Försök igen
                      </Button>
                    )}
                  </div>
                </div>
              </ViewerContainer>
            </CardContent>
          </Card>

          {/* Sidebar - hidden on mobile when there's an error */}
          <div className="hidden lg:flex flex-col space-y-4 lg:w-72">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Modellinformation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Objekt</p>
                  <p className="text-sm font-medium">{assetData?.commonName || assetData?.name || 'Laddar...'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Kategori</p>
                  <p className="text-sm font-medium">{assetData?.category || 'Okänd'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">FMGUID</p>
                  <p className="text-sm font-medium font-mono text-xs truncate">{fmGuid}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-sm font-medium text-amber-500">Väntar på viewer-paket</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Fully initialized viewer
  return (
    <div className="h-full flex flex-col p-2 sm:p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl font-semibold truncate">3D-visning</h2>
          <p className="text-sm text-muted-foreground truncate">
            {state.modelInfo?.name}
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0 ml-2">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Viewer content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-6 min-h-0">
        <Card className="flex-1 lg:flex-[3] min-h-0">
          <CardContent className="p-0 h-full">
            <ViewerContainer />
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="flex flex-col gap-4 lg:w-72">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Modellinformation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Objekt</p>
                <p className="text-sm font-medium">{state.modelInfo?.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Format</p>
                <p className="text-sm font-medium">{state.modelInfo?.type}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">FMGUID</p>
                <p className="text-sm font-medium font-mono text-xs truncate">{fmGuid}</p>
              </div>
              {state.modelInfo?.objectCount && (
                <div>
                  <p className="text-xs text-muted-foreground">Antal objekt</p>
                  <p className="text-sm font-medium">{state.modelInfo.objectCount.toLocaleString()}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="hidden lg:block">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Åtgärder</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" size="sm">
                Exportera vy
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                Mät avstånd
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                Lägg till anteckning
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start" 
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  toast.success('Länk kopierad!');
                }}
              >
                Dela länk
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AssetPlusViewer;
