import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, Loader2, DoorOpen, ArrowUp, ArrowDown, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import StreetViewMiniMap from './StreetViewMiniMap';
import { useLanguage } from '@/context/LanguageContext';
import { formatRoomLabel } from '@/lib/utils';

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
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null); // custom wheel/dblclick handler — not owned by the viewer, must be destroyed explicitly
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPos, setCurrentPos] = useState<{ lng: number; lat: number }>({ lng, lat });
  const [currentHeading, setCurrentHeading] = useState(0);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { t } = useLanguage();

  // Target room — lets "Enter building" hand off a route to the indoor wayfinding
  // pipeline (usePendingIndoorRoute) instead of only opening the 360° tour.
  const [rooms, setRooms] = useState<Array<{ fm_guid: string; name: string }>>([]);
  const [showRoomPicker, setShowRoomPicker] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');
  const [targetRoom, setTargetRoom] = useState<{ fm_guid: string; name: string } | null>(null);

  useEffect(() => {
    supabase
      .from('assets')
      .select('fm_guid, name, common_name')
      .eq('building_fm_guid', fmGuid)
      .in('category', ['Space', 'IfcSpace'])
      .order('name')
      .then(({ data }) => setRooms((data || []).map(r => ({
        fm_guid: r.fm_guid,
        name: formatRoomLabel(r.name, r.common_name) || r.fm_guid,
      }))));
  }, [fmGuid]);

  const filteredRooms = useMemo(() => {
    if (!roomSearch.trim()) return rooms;
    const q = roomSearch.toLowerCase();
    return rooms.filter(r => r.name.toLowerCase().includes(q));
  }, [rooms, roomSearch]);

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
        setCurrentPos({ lng: longitude, lat: latitude });

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
      const nextPano = await provider.getNearestPanoId(aheadCart, 100);
      if (nextPano && nextPano.panoId) {
        await loadPanoAtPosition(nextPano.panoId, nextPano.longitude, nextPano.latitude);
      }
    } catch (e: any) {
      console.warn('No panorama ahead:', e.message || e);
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
      const nextPano = await provider.getNearestPanoId(aheadCart, 100);
      if (nextPano && nextPano.panoId) {
        await loadPanoAtPosition(nextPano.panoId, nextPano.longitude, nextPano.latitude);
      }
    } catch (e: any) {
      console.warn('No panorama behind:', e.message || e);
    } finally {
      setMoving(false);
    }
  }, [moving, loadPanoAtPosition]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const init = async (container: HTMLDivElement) => {
      try {
        Cesium.Ion.defaultAccessToken = cesiumToken;

        const viewer = new Cesium.Viewer(container, {
          timeline: false, animation: false, baseLayerPicker: false,
          geocoder: false, homeButton: false, sceneModePicker: false,
          navigationHelpButton: false, infoBox: false, selectionIndicator: false,
          showRenderLoopErrors: false,
        });
        if (cancelled) { viewer.destroy(); return; }
        viewerRef.current = viewer;

        // Cesium can end up with a dead WebGL context (maximumCubeMapSize=0)
        // if the container was zero-sized at creation time — bail out cleanly
        // instead of letting the cube-map panorama load throw uncaught.
        viewer.scene.renderError.addEventListener((_scene: unknown, err: unknown) => {
          console.error('[StreetViewOverlay] Render error:', err);
          if (!cancelled) {
            setError(t('Kunde inte ladda Street View', 'Could not load Street View'));
            setLoading(false);
          }
        });

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
          setError(t('Ingen Street View-täckning vid denna position', 'No Street View coverage at this location'));
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
        setCurrentPos({ lng: panoIdObject.longitude, lat: panoIdObject.latitude });

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
        handlerRef.current = handler;
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
          setError(err.message || t('Kunde inte ladda Street View', 'Could not load Street View'));
          setLoading(false);
        }
      }
    };

    const el = containerRef.current;
    if (el.clientWidth === 0 || el.clientHeight === 0) {
      // Container not yet painted — poll until it has real dimensions before
      // creating the viewer (a zero-size canvas is what produces the
      // "maximumCubeMapSize (0)" DeveloperError).
      let attempts = 0;
      pollId = setInterval(() => {
        attempts++;
        if (cancelled) { if (pollId !== null) clearInterval(pollId); return; }
        if (el.clientWidth > 0 && el.clientHeight > 0) {
          if (pollId !== null) { clearInterval(pollId); pollId = null; }
          init(el);
        } else if (attempts >= 20) {
          if (pollId !== null) { clearInterval(pollId); pollId = null; }
          setError(t('Kunde inte ladda Street View', 'Could not load Street View'));
          setLoading(false);
        }
      }, 100);
    } else {
      init(el);
    }

    return () => {
      cancelled = true;
      if (pollId !== null) { clearInterval(pollId); pollId = null; }
      if (handlerRef.current) {
        handlerRef.current.destroy();
        handlerRef.current = null;
      }
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
      providerRef.current = null;
      currentPanoRef.current = null;
    };
  }, [lat, lng, cesiumToken, loadPanoAtPosition, t]);

  // Track heading changes
  useEffect(() => {
    if (loading) return;
    const interval = setInterval(() => {
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) {
        setCurrentHeading(Cesium.Math.toDegrees(viewer.camera.heading));
      }
    }, 200);
    return () => clearInterval(interval);
  }, [loading]);

  // Enter building — with a target room selected, hand off to the indoor wayfinding
  // pipeline (same pending_indoor_route contract the outdoor Mapbox map uses) instead
  // of the 360° tour, since the tour has no route/room concept at all.
  const handleEnterBuilding = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      const headingRad = viewer.camera.heading;
      const headingDeg = Cesium.Math.toDegrees(headingRad);
      sessionStorage.setItem('street-view-entry-heading', String(headingDeg));
    }
    onClose();
    if (targetRoom) {
      sessionStorage.setItem('pending_indoor_route', JSON.stringify({
        buildingFmGuid: fmGuid,
        targetRoomFmGuid: targetRoom.fm_guid,
      }));
      navigate(`/unified?building=${fmGuid}&returnTo=/`);
    } else {
      navigate(`/unified?building=${fmGuid}&mode=360&returnTo=/`);
    }
  }, [fmGuid, navigate, onClose, targetRoom]);

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
            title={t('Gå bakåt', 'Go back')}
          >
            <ArrowDown size={14} />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={moveForward}
            disabled={moving || loading}
            title={t('Gå framåt', 'Go forward')}
          >
            <ArrowUp size={14} />
          </Button>

          {/* Target room picker — optional destination for "Enter building" */}
          <div className="relative">
            {targetRoom ? (
              <button
                type="button"
                onClick={() => setTargetRoom(null)}
                className="h-7 flex items-center gap-1 px-2 rounded-md bg-primary/15 text-primary text-xs font-medium"
                title={t('Ta bort målrum', 'Clear target room')}
              >
                <MapPin size={11} />
                {targetRoom.name}
                <X size={11} />
              </button>
            ) : (
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowRoomPicker(p => !p)}
                title={t('Välj målrum', 'Pick target room')}
                disabled={rooms.length === 0}
              >
                <MapPin size={14} />
              </Button>
            )}

            {showRoomPicker && !targetRoom && (
              <div className="absolute top-full right-0 mt-1 w-56 bg-popover border border-border rounded-md shadow-lg z-20 p-2">
                <div className="relative mb-1.5">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={roomSearch}
                    onChange={e => setRoomSearch(e.target.value)}
                    placeholder={t('Sök rum…', 'Search rooms…')}
                    className="h-7 pl-6 text-xs"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {filteredRooms.map(room => (
                    <button
                      key={room.fm_guid}
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent/50 truncate"
                      onClick={() => { setTargetRoom(room); setShowRoomPicker(false); setRoomSearch(''); }}
                    >
                      {room.name}
                    </button>
                  ))}
                  {filteredRooms.length === 0 && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('Inga rum hittades', 'No rooms found')}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {(has360 || targetRoom) && (
            <Button variant="secondary" size="sm" className="h-7 text-xs gap-1" onClick={handleEnterBuilding}>
              <DoorOpen size={12} />
              {targetRoom ? t('Gå till rum', 'Go to room') : t('Gå in i byggnaden', 'Enter building')}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 relative" />

      {/* Mini-map overlay */}
      {!loading && !error && (
        <StreetViewMiniMap
          lng={currentPos.lng}
          lat={currentPos.lat}
          heading={currentHeading}
          buildingLng={lng}
          buildingLat={lat}
          buildingName={buildingName}
        />
      )}

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
            <span className="text-sm">{loading ? t('Laddar Street View…', 'Loading Street View…') : t('Laddar panorama…', 'Loading panorama…')}</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={onClose}>{t('Stäng', 'Close')}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StreetViewOverlay;
