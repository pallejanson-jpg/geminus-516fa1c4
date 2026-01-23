import React, { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { Box, Maximize2, RotateCcw, ZoomIn, ZoomOut, Layers, Loader2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

/**
 * Asset+ 3D Viewer Component
 * 
 * Integrates with the Asset+ 3D Viewer package to display BIM models.
 * The viewer requires:
 * 1. Access token from Asset+ authentication
 * 2. FMGUID to identify which model to load
 * 
 * Based on Asset+ 3D Viewer Package documentation.
 */
const AssetPlusViewer: React.FC<AssetPlusViewerProps> = ({ fmGuid, onClose }) => {
  const { allData, setActiveApp } = useContext(AppContext);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewerInstanceRef = useRef<any>(null);
  
  const [state, setState] = useState<ViewerState>({
    isLoading: true,
    isInitialized: false,
    error: null,
    modelInfo: null,
  });

  // Find the asset data for the given fmGuid
  const assetData = allData.find((a: any) => a.fmGuid === fmGuid);

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

      // Check if assetplusviewer is available globally
      // The viewer package should be loaded via script tag
      const assetplusviewer = (window as any).assetplusviewer;
      
      if (!assetplusviewer) {
        // Viewer package not loaded - show setup instructions
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

      // Initialize the viewer following Asset+ documentation
      const viewer = await assetplusviewer(
        baseUrl,
        apiKey,
        async () => accessToken, // getAccessTokenCallback
        (items: any[], added: any[], removed: any[]) => {
          console.log('Selection changed:', { items, added, removed });
        },
        (fmGuids: string[], added: string[], removed: string[]) => {
          console.log('FMGUIDs changed:', { fmGuids, added, removed });
        },
        () => {
          console.log('All models loaded');
          toast.success('3D-modell laddad');
        },
        async () => true, // isItemIdEditableCallback
        async () => false, // isFmGuidEditableCallback
        () => true, // additionalDefaultPredicate - load all models
        [], // externalCustomObjectContextMenuItems
        135, // horizontalAngle
        45, // verticalAngle
        -10, // annotationTopOffset
        -10 // annotationLeftOffset
      );

      viewerInstanceRef.current = viewer;

      // Load the model by FMGUID
      await viewer.setAvailableModelsByFmGuid(fmGuid);
      viewer.clearSelection();

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
  }, [fmGuid, assetData]);

  // Initialize on mount
  useEffect(() => {
    initializeViewer();

    return () => {
      // Cleanup viewer on unmount
      if (viewerInstanceRef.current?.clearData) {
        viewerInstanceRef.current.clearData();
      }
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
    viewerInstanceRef.current?.assetViewer?.$refs?.assetView?.onCommand?.('resetView');
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

  // Show loading state
  if (state.isLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-muted rounded-lg">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div>
              <p className="text-lg font-medium">Laddar 3D-modell...</p>
              <p className="text-sm text-muted-foreground">FMGUID: {fmGuid}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state with placeholder
  if (state.error || !state.isInitialized) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">3D-visning</h2>
            <p className="text-sm text-muted-foreground">
              {assetData?.commonName || assetData?.name || fmGuid}
            </p>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Placeholder viewer area */}
        <div className="flex-1 grid gap-6 lg:grid-cols-4">
          <Card className="lg:col-span-3">
            <CardContent className="p-0">
              <div 
                ref={viewerContainerRef}
                id="AssetPlusViewer"
                className="relative aspect-video w-full bg-muted rounded-lg overflow-hidden"
                style={{
                  background: 'radial-gradient(90% 100% at center top, rgb(236, 236, 236), rgb(42, 42, 50))',
                }}
              >
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
                      <p className="text-lg font-medium">
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

                {/* Viewer Controls */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/90 backdrop-blur-sm rounded-lg p-2 border">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-6 bg-border" />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleResetView}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleFullscreen}>
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Layer Toggle */}
                <div className="absolute top-4 right-4">
                  <Button variant="secondary" size="sm" className="gap-2">
                    <Layers className="h-4 w-4" />
                    Lager
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sidebar */}
          <div className="space-y-4">
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

            <Card>
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
  }

  // Fully initialized viewer
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">3D-visning</h2>
          <p className="text-sm text-muted-foreground">
            {state.modelInfo?.name}
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Viewer content */}
      <div className="flex-1 grid gap-6 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <CardContent className="p-0">
            <div 
              ref={viewerContainerRef}
              id="AssetPlusViewer"
              className="relative aspect-video w-full rounded-lg overflow-hidden dx-viewport"
              style={{
                background: 'radial-gradient(90% 100% at center top, rgb(236, 236, 236), rgb(42, 42, 50))',
              }}
            >
              {/* Viewer Controls */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/90 backdrop-blur-sm rounded-lg p-2 border z-10">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border" />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleResetView}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleFullscreen}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Layer Toggle */}
              <div className="absolute top-4 right-4 z-10">
                <Button variant="secondary" size="sm" className="gap-2">
                  <Layers className="h-4 w-4" />
                  Lager
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
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

          <Card>
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