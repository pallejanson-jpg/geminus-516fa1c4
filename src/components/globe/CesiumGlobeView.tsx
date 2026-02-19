import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Viewer,
  Entity,
  CameraFlyTo,
  CesiumComponentRef,
} from 'resium';
import * as Cesium from '@cesium/engine';
import { Building2, Eye, Globe, Loader2, Box, RotateCcw } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

interface BuildingCoord {
  fm_guid: string;
  latitude: number;
  longitude: number;
  name?: string;
  ivion_site_id?: string | null;
}

interface ContextMenu {
  x: number;
  y: number;
  facility: BuildingCoord & { displayName: string; has360: boolean };
}

// Build Cesium Cartesian3 from lat/lng
function toCartesian(lat: number, lng: number, height = 0) {
  return Cesium.Cartesian3.fromDegrees(lng, lat, height);
}

const CesiumGlobeView: React.FC = () => {
  const { navigatorTreeData, setActiveApp, setSelectedFacility, allData, open360WithContext, appConfigs } = useContext(AppContext);
  const navigate = useNavigate();

  const viewerRef = useRef<CesiumComponentRef<any>>(null);

  const [cesiumToken, setCesiumToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const [buildingCoords, setBuildingCoords] = useState<BuildingCoord[]>([]);
  const [show3dBuildings, setShow3dBuildings] = useState(false);
  const [osmBuildingsLayer, setOsmBuildingsLayer] = useState<Cesium.Cesium3DTileset | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [selectedFmGuid, setSelectedFmGuid] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<Cesium.Cartesian3 | null>(null);

  // Fetch Cesium Ion token from backend
  useEffect(() => {
    supabase.functions.invoke('get-cesium-token').then(({ data, error }) => {
      if (!error && data?.token) {
        setCesiumToken(data.token);
        Cesium.Ion.defaultAccessToken = data.token;
      } else {
        // Use anonymous/default token (limited but functional)
        setTokenError(true);
        Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc4ZTkiLCJpZCI6NTc3MzMsImlhdCI6MTYyMjY0NjQ5OH0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk';
      }
    });
  }, []);

  // Fetch building coordinates from building_settings
  useEffect(() => {
    const fetchCoords = async () => {
      const { data } = await supabase
        .from('building_settings')
        .select('fm_guid, latitude, longitude, ivion_site_id');
      if (data) {
        setBuildingCoords(
          data
            .filter(d => d.latitude !== null && d.longitude !== null)
            .map(d => ({
              fm_guid: d.fm_guid,
              latitude: d.latitude!,
              longitude: d.longitude!,
              ivion_site_id: d.ivion_site_id,
            }))
        );
      }
    };
    fetchCoords();
  }, []);

  // Combine with navigator tree data for display names
  const facilities = useMemo(() => {
    return buildingCoords.map(coord => {
      const treeNode = navigatorTreeData.find(
        n => n.fmGuid.toLowerCase() === coord.fm_guid.toLowerCase()
      );
      return {
        ...coord,
        displayName: treeNode?.commonName || treeNode?.name || coord.fm_guid.substring(0, 8),
        has360: !!coord.ivion_site_id,
      };
    });
  }, [buildingCoords, navigatorTreeData]);

  // Toggle OSM 3D buildings tileset
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    if (show3dBuildings) {
      Cesium.createOsmBuildingsAsync().then(tileset => {
        viewer.scene.primitives.add(tileset);
        setOsmBuildingsLayer(tileset);
      }).catch(err => {
        console.warn('OSM 3D Buildings requires Cesium Ion token:', err);
      });
    } else {
      if (osmBuildingsLayer) {
        const viewer = viewerRef.current?.cesiumElement;
        if (viewer) viewer.scene.primitives.remove(osmBuildingsLayer);
        setOsmBuildingsLayer(null);
      }
    }
  }, [show3dBuildings]);

  const handlePinClick = useCallback((facility: typeof facilities[0]) => {
    setSelectedFmGuid(facility.fm_guid);
    const pos = toCartesian(facility.latitude, facility.longitude, 300);
    setFlyTarget(pos);
  }, []);

  const handlePinRightClick = useCallback((e: React.MouseEvent, facility: typeof facilities[0]) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      facility,
    });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleOpenViewer = useCallback((fmGuid: string) => {
    closeContextMenu();
    // Find the facility to set it as selected
    const node = navigatorTreeData.find(n => n.fmGuid.toLowerCase() === fmGuid.toLowerCase());
    if (node) setSelectedFacility(node);
    navigate(`/split-viewer?building=${fmGuid}&mode=3d`);
  }, [navigatorTreeData, setSelectedFacility, navigate, closeContextMenu]);

  const handleOpen360 = useCallback((facility: ContextMenu['facility']) => {
    closeContextMenu();
    const radarConfig = appConfigs?.radar || {};
    const ivionUrl = radarConfig.url || 'https://swg.iv.navvis.com';
    open360WithContext({
      buildingFmGuid: facility.fm_guid,
      buildingName: facility.displayName,
      ivionSiteId: facility.ivion_site_id || '',
      ivionUrl,
    });
  }, [appConfigs, open360WithContext, closeContextMenu]);

  const handleResetView = useCallback(() => {
    const el = viewerRef.current?.cesiumElement as any;
    if (!el) return;
    el.camera?.flyHome(1.5);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
      {/* Cesium Viewer */}
      <Viewer
        ref={viewerRef}
        full
        timeline={false}
        animation={false}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        infoBox={false}
        selectionIndicator={false}
        style={{ position: 'absolute', inset: 0 }}
      >
        {flyTarget && (
          <CameraFlyTo
            destination={flyTarget}
            duration={1.5}
            once
          />
        )}

        {/* Building pins */}
        {facilities.map(facility => (
          <Entity
            key={facility.fm_guid}
            position={toCartesian(facility.latitude, facility.longitude)}
            name={facility.displayName}
            billboard={{
              image: selectedFmGuid === facility.fm_guid
                ? '/favicon.ico'
                : undefined,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              scale: 1.2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }}
            point={{
              pixelSize: selectedFmGuid === facility.fm_guid ? 18 : 14,
              color: selectedFmGuid === facility.fm_guid
                ? Cesium.Color.fromCssColorString('#a78bfa')
                : Cesium.Color.fromCssColorString('#60a5fa'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            }}
            label={{
              text: facility.displayName,
              font: '13px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -28),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#00000066'),
              backgroundPadding: new Cesium.Cartesian2(6, 3),
            }}
            onClick={() => handlePinClick(facility)}
          />
        ))}
      </Viewer>

      {/* Overlay HTML pins for right-click */}
      {/* We use a transparent overlay to handle right-click; Cesium entity onClick handles left-click */}
      {/* The context menu is rendered as HTML */}

      {/* Top-left controls */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <Card className="bg-card/90 backdrop-blur-sm shadow-lg border-border">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Globe size={16} className="text-primary" />
              <span className="text-sm font-semibold text-foreground">Cesium Globe</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="toggle-3d" className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Box size={12} />
                3D-byggnader
              </Label>
              <Switch
                id="toggle-3d"
                checked={show3dBuildings}
                onCheckedChange={setShow3dBuildings}
              />
            </div>
            {tokenError && (
              <p className="text-[10px] text-amber-400">
                Inget Cesium Ion token — 3D kräver token
              </p>
            )}
          </CardContent>
        </Card>

        {/* Building count badge */}
        <Badge variant="secondary" className="w-fit text-xs bg-card/90 backdrop-blur-sm">
          <Building2 size={12} className="mr-1" />
          {facilities.length} byggnader
        </Badge>
      </div>

      {/* Reset view */}
      <Button
        variant="secondary"
        size="icon"
        onClick={handleResetView}
        className="absolute top-4 right-4 z-20 bg-card/90 backdrop-blur-sm shadow-lg"
        title="Återställ vy"
      >
        <RotateCcw size={16} />
      </Button>

      {/* Right-click context menu overlay — transparent canvas to capture right-clicks */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        onContextMenu={(e) => {
          e.preventDefault();
          // Try to determine which building was right-clicked using screen coordinates
          const viewer = viewerRef.current?.cesiumElement as any;
          if (!viewer) return;
          const cartesian = viewer.camera.pickEllipsoid(
            new Cesium.Cartesian2(e.clientX, e.clientY),
            viewer.scene.globe.ellipsoid
          );
          if (!cartesian) return;
          const carto = Cesium.Cartographic.fromCartesian(cartesian);
          const lat = Cesium.Math.toDegrees(carto.latitude);
          const lng = Cesium.Math.toDegrees(carto.longitude);

          // Find nearest building within ~0.1°
          let nearest: typeof facilities[0] | null = null;
          let minDist = 0.05;
          for (const f of facilities) {
            const dist = Math.sqrt(
              Math.pow(f.latitude - lat, 2) + Math.pow(f.longitude - lng, 2)
            );
            if (dist < minDist) {
              minDist = dist;
              nearest = f;
            }
          }

          if (nearest) {
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, facility: nearest });
          }
        }}
        style={{ pointerEvents: 'auto' }}
      />

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-card/95 backdrop-blur-sm shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold text-foreground truncate">
              {contextMenu.facility.displayName}
            </p>
          </div>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
            onClick={() => handleOpenViewer(contextMenu.facility.fm_guid)}
          >
            <Eye size={14} className="text-primary" />
            Visa Viewer (3D)
          </button>
          {contextMenu.facility.has360 && (
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
              onClick={() => handleOpen360(contextMenu.facility)}
            >
              <Globe size={14} className="text-pink-400" />
              Visa 360°
            </button>
          )}
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
            onClick={() => {
              const node = navigatorTreeData.find(
                n => n.fmGuid.toLowerCase() === contextMenu.facility.fm_guid.toLowerCase()
              );
              if (node) {
                setSelectedFacility(node);
                setActiveApp('portfolio');
              }
              closeContextMenu();
            }}
          >
            <Building2 size={14} className="text-blue-400" />
            Visa detaljer
          </button>
        </div>
      )}

      {/* No buildings message */}
      {facilities.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <Card className="bg-card/90 backdrop-blur-sm">
            <CardContent className="p-4 flex flex-col items-center gap-2">
              <Building2 size={24} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                Inga byggnader med koordinater.<br />
                Konfigurera koordinater i Inställningar.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default CesiumGlobeView;
