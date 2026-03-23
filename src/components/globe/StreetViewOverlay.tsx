import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Loader2, DoorOpen, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// Import Cesium — base URL already set by CesiumGlobeView
import * as Cesium from 'cesium';

interface StreetViewOverlayProps {
  lat: number;
  lng: number;
  buildingName: string;
  fmGuid: string;
  has360?: boolean;
  cesiumToken: string;
  onClose: () => void;
}

const StreetViewOverlay: React.FC<StreetViewOverlayProps> = ({
  lat, lng, buildingName, fmGuid, has360, cesiumToken, onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const init = async () => {
      try {
        // Ensure token is set
        Cesium.Ion.defaultAccessToken = cesiumToken;

        // Create lightweight viewer for Street View only
        const viewer = new Cesium.Viewer(containerRef.current!, {
          timeline: false, animation: false, baseLayerPicker: false,
          geocoder: false, homeButton: false, sceneModePicker: false,
          navigationHelpButton: false, infoBox: false, selectionIndicator: false,
        });
        if (cancelled) { viewer.destroy(); return; }
        viewerRef.current = viewer;

        // Hide globe — Street View renders as scene primitives
        viewer.scene.globe.show = false;

        // Minimize credits
        const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement;
        if (creditContainer) {
          creditContainer.style.transform = 'scale(0.6)';
          creditContainer.style.transformOrigin = 'bottom right';
          creditContainer.style.opacity = '0.4';
        }

        // Get Street View key via Ion experimental endpoint
        const ionResponse = await Cesium.Resource.fetchJson({
          url: `${Cesium.Ion.defaultServer}/experimental/panoramas/google`,
          headers: { Authorization: `Bearer ${cesiumToken}` },
        });

        if (cancelled) return;

        (Cesium as any).GoogleMaps.defaultStreetViewStaticApiKey = ionResponse.options.key;
        (Cesium as any).GoogleMaps.streetViewStaticApiEndpoint = ionResponse.options.url;

        // Create provider
        const provider = await (Cesium as any).GoogleStreetViewCubeMapPanoramaProvider.fromUrl();
        if (cancelled) return;

        // Find nearest panorama
        const cartographic = Cesium.Cartographic.fromDegrees(lng, lat, 0);
        const panoIdObject = await provider.getNearestPanoId(cartographic, 200);

        if (!panoIdObject) {
          setError('Ingen Street View-täckning vid denna position');
          setLoading(false);
          return;
        }

        // Load panorama
        const panoCartographic = Cesium.Cartographic.fromDegrees(
          panoIdObject.longitude, panoIdObject.latitude, 0
        );
        const streetViewPanorama = await provider.loadPanorama({
          cartographic: panoCartographic,
          panoId: panoIdObject.panoId,
        });
        if (cancelled) return;

        viewer.scene.primitives.add(streetViewPanorama);

        // Position camera inside panorama
        const lookPosition = Cesium.Cartesian3.fromDegrees(
          panoIdObject.longitude, panoIdObject.latitude, 0
        );
        viewer.scene.camera.lookAt(
          lookPosition,
          new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-90), 0, 2)
        );

        // Configure controls: rotation/tilt only
        const controller = viewer.scene.screenSpaceCameraController;
        controller.enableRotate = true;
        controller.enableTilt = true;
        controller.enableTranslate = false;
        controller.enableZoom = false;

        // Scroll-wheel FOV zoom
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        const minFov = Cesium.Math.toRadians(20.0);
        const maxFov = Cesium.Math.toRadians(100.0);
        const zoomSpeed = 0.05;

        handler.setInputAction((wheelDelta: number) => {
          const frustum = viewer.camera.frustum as Cesium.PerspectiveFrustum;
          let fov = frustum.fov;
          if (wheelDelta < 0) {
            fov *= 1.0 + zoomSpeed;
          } else {
            fov *= 1.0 - zoomSpeed;
          }
          frustum.fov = Cesium.Math.clamp(fov, minFov, maxFov);
        }, Cesium.ScreenSpaceEventType.WHEEL);

        setLoading(false);
      } catch (err: any) {
        console.error('Street View init error:', err);
        if (!cancelled) {
          setError(err.message || 'Kunde inte ladda Street View');
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
    };
  }, [lat, lng, cesiumToken]);

  // Enter building: capture heading and navigate to 360° view
  const handleEnterBuilding = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      const headingRad = viewer.camera.heading;
      const headingDeg = Cesium.Math.toDegrees(headingRad);
      sessionStorage.setItem('street-view-entry-heading', String(headingDeg));
    }
    onClose();
    navigate(`/unified?building=${fmGuid}&mode=360&returnTo=/`);
  }, [fmGuid, navigate, onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-card/95 backdrop-blur-sm border-b border-border z-10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Street View</span>
          <span className="text-xs text-muted-foreground">— {buildingName}</span>
        </div>
        <div className="flex items-center gap-1">
          {has360 && (
            <Button variant="secondary" size="sm" className="h-7 text-xs gap-1" onClick={handleEnterBuilding}>
              <DoorOpen size={12} />
              Gå in i byggnaden
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Cesium container */}
      <div ref={containerRef} className="flex-1 relative" />

      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Laddar Street View…</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={onClose}>Stäng</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StreetViewOverlay;
