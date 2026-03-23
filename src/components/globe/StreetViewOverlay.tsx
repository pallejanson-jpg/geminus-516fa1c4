import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Loader2, DoorOpen, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const providerRef = useRef<any>(null);
  const currentPosRef = useRef<{ lng: number; lat: number }>({ lng, lat });
  const currentPanoRef = useRef<any>(null); // current panorama primitive
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Load a panorama at given position, replacing the current one
  const loadPanoAtPosition = useCallback(async (panoId: string, longitude: number, latitude: number) => {
    const viewer = viewerRef.current;
    const provider = providerRef.current;
    if (!viewer || viewer.isDestroyed() || !provider) return;

    setMoving(true);
    try {
      // Save current heading to preserve orientation
      const heading = viewer.camera.heading;

      // Remove old panorama
      if (currentPanoRef.current) {
        viewer.scene.primitives.remove(currentPanoRef.current);
        currentPanoRef.current = null;
      }

      const panoCartographic = Cesium.Cartographic.fromDegrees(longitude, latitude, 0);
      const pano = await provider.loadPanorama({
        cartographic: panoCartographic,
        panoId,
      });

      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.add(pano);
        currentPanoRef.current = pano;
        currentPosRef.current = { lng: longitude, lat: latitude };

        // Position camera inside new panorama with preserved heading
        const pos = Cesium.Cartesian3.fromDegrees(longitude, latitude, 0);
        viewer.scene.camera.lookAt(
          pos,
          new Cesium.HeadingPitchRange(heading, 0, 2)
        );
      }
    } catch (err) {
      console.error('Failed to load panorama:', err);
    } finally {
      setMoving(false);
    }
  }, []);

  // Move forward in current look direction
  const moveForward = useCallback(async () => {
    const viewer = viewerRef.current;
    const provider = providerRef.current;
    if (!viewer || viewer.isDestroyed() || !provider || moving) return;

    const heading = viewer.camera.heading;
    const pos = currentPosRef.current;

    // Calculate point ~30m ahead
    const dLat = (30 / 111320) * Math.cos(heading);
    const dLng = (30 / (111320 * Math.cos(pos.lat * Math.PI / 180))) * Math.sin(heading);
    const aheadCart = Cesium.Cartographic.fromDegrees(pos.lng + dLng, pos.lat + dLat, 0);

    try {
      setMoving(true);
      const nextPano = await provider.getNearestPanoId(aheadCart, 50);
      if (nextPano && nextPano.panoId) {
        await loadPanoAtPosition(nextPano.panoId, nextPano.longitude, nextPano.latitude);
      }
    } catch {
      // No panorama found in that direction
    } finally {
      setMoving(false);
    }
  }, [moving, loadPanoAtPosition]);

  // Move backward (opposite direction)
  const moveBackward = useCallback(async () => {
    const viewer = viewerRef.current;
    const provider = providerRef.current;
    if (!viewer || viewer.isDestroyed() || !provider || moving) return;

    const heading = viewer.camera.heading + Math.PI; // reverse
    const pos = currentPosRef.current;

    const dLat = (30 / 111320) * Math.cos(heading);
    const dLng = (30 / (111320 * Math.cos(pos.lat * Math.PI / 180))) * Math.sin(heading);
    const aheadCart = Cesium.Cartographic.fromDegrees(pos.lng + dLng, pos.lat + dLat, 0);

    try {
      setMoving(true);
      const nextPano = await provider.getNearestPanoId(aheadCart, 50);
      if (nextPano && nextPano.panoId) {
        await loadPanoAtPosition(nextPano.panoId, nextPano.longitude, nextPano.latitude);
      }
    } catch {
      // No panorama found
    } finally {
      setMoving(false);
    }
  }, [moving, loadPanoAtPosition]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const init = async () => {
      try {
        Cesium.Ion.defaultAccessToken = cesiumToken;

        const viewer = new Cesium.Viewer(containerRef.current!, {
          timeline: false, animation: false, baseLayerPicker: false,
          geocoder: false, homeButton: false, sceneModePicker: false,
          navigationHelpButton: false, infoBox: false, selectionIndicator: false,
        });
        if (cancelled) { viewer.destroy(); return; }
        viewerRef.current = viewer;

        viewer.scene.globe.show = false;

        const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement;
        if (creditContainer) {
          creditContainer.style.transform = 'scale(0.6)';
          creditContainer.style.transformOrigin = 'bottom right';
          creditContainer.style.opacity = '0.4';
        }

        // Get Street View key
        const ionResponse = await Cesium.Resource.fetchJson({
          url: `${Cesium.Ion.defaultServer}/experimental/panoramas/google`,
          headers: { Authorization: `Bearer ${cesiumToken}` },
        });
        if (cancelled) return;

        (Cesium as any).GoogleMaps.defaultStreetViewStaticApiKey = ionResponse.options.key;
        (Cesium as any).GoogleMaps.streetViewStaticApiEndpoint = ionResponse.options.url;

        const provider = await (Cesium as any).GoogleStreetViewCubeMapPanoramaProvider.fromUrl();
        if (cancelled) return;
        providerRef.current = provider;

        // Find nearest panorama — try progressively larger radii
        const cartographic = Cesium.Cartographic.fromDegrees(lng, lat, 0);
        let panoIdObject = null;
        for (const radius of [200, 500, 1000, 2000]) {
          try {
            panoIdObject = await provider.getNearestPanoId(cartographic, radius);
            if (panoIdObject) break;
          } catch (e: any) {
            // ZERO_RESULTS or similar — try larger radius
            console.warn(`Street View search radius ${radius}m: ${e.message || 'no results'}`);
          }
        }

        if (!panoIdObject) {
          setError('Ingen Street View-täckning vid denna position');
          setLoading(false);
          return;
        }

        // Load initial panorama
        const panoCartographic = Cesium.Cartographic.fromDegrees(
          panoIdObject.longitude, panoIdObject.latitude, 0
        );
        const streetViewPanorama = await provider.loadPanorama({
          cartographic: panoCartographic,
          panoId: panoIdObject.panoId,
        });
        if (cancelled) return;

        viewer.scene.primitives.add(streetViewPanorama);
        currentPanoRef.current = streetViewPanorama;
        currentPosRef.current = { lng: panoIdObject.longitude, lat: panoIdObject.latitude };

        // Position camera
        const lookPosition = Cesium.Cartesian3.fromDegrees(
          panoIdObject.longitude, panoIdObject.latitude, 0
        );
        viewer.scene.camera.lookAt(
          lookPosition,
          new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-90), 0, 2)
        );

        // Configure controls
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

        // Double-click to move forward
        handler.setInputAction(() => {
          // Use a timeout to let the ref update
          setTimeout(() => {
            const v = viewerRef.current;
            const p = providerRef.current;
            if (!v || v.isDestroyed() || !p) return;

            const h = v.camera.heading;
            const cp = currentPosRef.current;
            const dLat = (30 / 111320) * Math.cos(h);
            const dLng = (30 / (111320 * Math.cos(cp.lat * Math.PI / 180))) * Math.sin(h);
            const ac = Cesium.Cartographic.fromDegrees(cp.lng + dLng, cp.lat + dLat, 0);

            p.getNearestPanoId(ac, 50).then((next: any) => {
              if (next && next.panoId) {
                loadPanoAtPosition(next.panoId, next.longitude, next.latitude);
              }
            }).catch(() => {});
          }, 0);
        }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

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
      providerRef.current = null;
      currentPanoRef.current = null;
    };
  }, [lat, lng, cesiumToken, loadPanoAtPosition]);

  // Enter building
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
          {/* Navigation arrows */}
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={moveBackward}
            disabled={moving || loading}
            title="Gå bakåt"
          >
            <ArrowDown size={14} />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={moveForward}
            disabled={moving || loading}
            title="Gå framåt"
          >
            <ArrowUp size={14} />
          </Button>

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

      {/* Mobile: large forward button at bottom center */}
      {isMobile && !loading && !error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-2">
          <Button
            variant="secondary"
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg bg-card/90 backdrop-blur-sm"
            onClick={moveBackward}
            disabled={moving}
          >
            <ArrowDown size={20} />
          </Button>
          <Button
            variant="default"
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg"
            onClick={moveForward}
            disabled={moving}
          >
            <ArrowUp size={20} />
          </Button>
        </div>
      )}

      {/* Loading / moving state */}
      {(loading || moving) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20 pointer-events-none">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">{loading ? 'Laddar Street View…' : 'Laddar panorama…'}</span>
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
