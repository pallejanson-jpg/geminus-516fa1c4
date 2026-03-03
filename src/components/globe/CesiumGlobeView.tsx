import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Viewer, type CesiumComponentRef } from 'resium';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Building2, Eye, Globe, Box, RotateCcw } from 'lucide-react';
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

function toCartesian(lat: number, lng: number, height = 0) {
  return Cesium.Cartesian3.fromDegrees(lng, lat, height);
}

const CesiumGlobeView: React.FC = () => {
  const { navigatorTreeData, setActiveApp, setSelectedFacility, open360WithContext, appConfigs } = useContext(AppContext);
  const navigate = useNavigate();

  const viewerRef = useRef<CesiumComponentRef<any> | null>(null);
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const pinDataSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const facilitiesByGuidRef = useRef<Map<string, BuildingCoord & { displayName: string; has360: boolean }>>(new Map());
  const osmBuildingsLayerRef = useRef<Cesium.Cesium3DTileset | null>(null);

  const [tokenError, setTokenError] = useState(false);
  const [buildingCoords, setBuildingCoords] = useState<BuildingCoord[]>([]);
  const [show3dBuildings, setShow3dBuildings] = useState(false);
  const [osmBuildingsLayer, setOsmBuildingsLayer] = useState<Cesium.Cesium3DTileset | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [selectedFmGuid, setSelectedFmGuid] = useState<string | null>(null);

  // Fetch Cesium token
  useEffect(() => {
    supabase.functions.invoke('get-cesium-token').then(({ data, error }) => {
      if (!error && data?.token) {
        Cesium.Ion.defaultAccessToken = data.token;
      } else {
        setTokenError(true);
        Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc4ZTkiLCJpZCI6NTc3MzMsImlhdCI6MTYyMjY0NjQ5OH0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk';
      }
    });
  }, []);

  // Fetch building coordinates
  useEffect(() => {
    const fetchCoords = async () => {
      const { data } = await supabase
        .from('building_settings')
        .select('fm_guid, latitude, longitude, ivion_site_id');

      if (!data) return;

      setBuildingCoords(
        data
          .filter(d => d.latitude !== null && d.longitude !== null)
          .map(d => ({
            fm_guid: d.fm_guid,
            latitude: d.latitude!,
            longitude: d.longitude!,
            ivion_site_id: d.ivion_site_id,
          })),
      );
    };

    fetchCoords();
  }, []);

  const facilities = useMemo(() => {
    return buildingCoords.map(coord => {
      const treeNode = navigatorTreeData.find(
        n => n.fmGuid.toLowerCase() === coord.fm_guid.toLowerCase(),
      );

      return {
        ...coord,
        displayName: treeNode?.commonName || treeNode?.name || coord.fm_guid.substring(0, 8),
        has360: !!coord.ivion_site_id,
      };
    });
  }, [buildingCoords, navigatorTreeData]);

  const facilitiesByGuid = useMemo(() => {
    const map = new Map<string, (typeof facilities)[number]>();
    facilities.forEach(f => map.set(f.fm_guid, f));
    return map;
  }, [facilities]);

  useEffect(() => {
    facilitiesByGuidRef.current = facilitiesByGuid;
  }, [facilitiesByGuid]);

  useEffect(() => {
    osmBuildingsLayerRef.current = osmBuildingsLayer;
  }, [osmBuildingsLayer]);

  const handlePinClick = useCallback((facility: (typeof facilities)[number]) => {
    setSelectedFmGuid(facility.fm_guid);
    const viewer = viewerRef.current?.cesiumElement as any;
    if (!viewer?.camera) return;

    viewer.camera.flyTo({
      destination: toCartesian(facility.latitude, facility.longitude, 300),
      duration: 1.5,
    });
  }, []);

  const handleOpenViewer = useCallback((fmGuid: string) => {
    setContextMenu(null);
    const node = navigatorTreeData.find(n => n.fmGuid.toLowerCase() === fmGuid.toLowerCase());
    if (node) setSelectedFacility(node);
    navigate(`/split-viewer?building=${fmGuid}&mode=3d`);
  }, [navigatorTreeData, setSelectedFacility, navigate]);

  const handleOpen360 = useCallback((facility: ContextMenu['facility']) => {
    setContextMenu(null);
    const radarConfig = appConfigs?.radar || {};
    const ivionUrl = radarConfig.url || 'https://swg.iv.navvis.com';

    open360WithContext({
      buildingFmGuid: facility.fm_guid,
      buildingName: facility.displayName,
      ivionSiteId: facility.ivion_site_id || '',
      ivionUrl,
    });
  }, [appConfigs, open360WithContext]);

  const handleResetView = useCallback(() => {
    const viewer = viewerRef.current?.cesiumElement as any;
    viewer?.camera?.flyHome?.(1.5);
  }, []);

  const ensureViewerSetup = useCallback(() => {
    const viewer = viewerRef.current?.cesiumElement as any;
    if (!viewer || pinDataSourceRef.current) return;

    viewer.scene.globe.depthTestAgainstTerrain = false;

    const pinDataSource = new Cesium.CustomDataSource('facility-pins');
    pinDataSourceRef.current = pinDataSource;
    viewer.dataSources.add(pinDataSource);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandlerRef.current = handler;

    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position);
      const entity = picked?.id as Cesium.Entity | undefined;
      const fmGuid = entity?.properties?.fm_guid?.getValue?.() as string | undefined;
      if (!fmGuid) return;

      const facility = facilitiesByGuidRef.current.get(fmGuid);
      if (!facility) return;

      setContextMenu(null);
      handlePinClick(facility);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position);
      const entity = picked?.id as Cesium.Entity | undefined;
      const fmGuid = entity?.properties?.fm_guid?.getValue?.() as string | undefined;
      if (!fmGuid) return;

      const facility = facilitiesByGuidRef.current.get(fmGuid);
      if (!facility) return;

      const rect = viewer.scene.canvas.getBoundingClientRect();
      setContextMenu({
        x: rect.left + movement.position.x,
        y: rect.top + movement.position.y,
        facility,
      });
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }, [handlePinClick]);

  useEffect(() => {
    ensureViewerSetup();
  }, [ensureViewerSetup, facilities.length]);

  // Keep pin layer in sync
  useEffect(() => {
    ensureViewerSetup();

    const dataSource = pinDataSourceRef.current;
    if (!dataSource) return;

    dataSource.entities.removeAll();

    facilities.forEach(facility => {
      const isSelected = selectedFmGuid === facility.fm_guid;

      dataSource.entities.add({
        id: `facility-${facility.fm_guid}`,
        position: toCartesian(facility.latitude, facility.longitude),
        properties: {
          fm_guid: facility.fm_guid,
        },
        point: {
          pixelSize: isSelected ? 18 : 14,
          color: isSelected
            ? Cesium.Color.fromCssColorString('hsl(262 83% 58%)')
            : Cesium.Color.fromCssColorString('hsl(212 92% 60%)'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
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
          backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.4)'),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
        },
      });
    });
  }, [ensureViewerSetup, facilities, selectedFmGuid]);

  // Toggle OSM 3D buildings
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement as any;
    if (!viewer) return;

    if (show3dBuildings) {
      let cancelled = false;

      Cesium.createOsmBuildingsAsync()
        .then(tileset => {
          if (cancelled) return;
          viewer.scene.primitives.add(tileset);
          setOsmBuildingsLayer(tileset);
        })
        .catch(err => {
          console.warn('OSM 3D Buildings requires Cesium token:', err);
        });

      return () => {
        cancelled = true;
      };
    }

    if (osmBuildingsLayer) {
      viewer.scene.primitives.remove(osmBuildingsLayer);
      setOsmBuildingsLayer(null);
    }
  }, [show3dBuildings, osmBuildingsLayer]);

  // Cleanup once on unmount
  useEffect(() => {
    return () => {
      clickHandlerRef.current?.destroy();
      clickHandlerRef.current = null;

      const viewer = viewerRef.current?.cesiumElement as any;
      const dataSource = pinDataSourceRef.current;
      if (viewer && dataSource) {
        viewer.dataSources?.remove?.(dataSource, true);
      }
      pinDataSourceRef.current = null;

      const osmLayer = osmBuildingsLayerRef.current;
      if (viewer && osmLayer) {
        viewer.scene?.primitives?.remove?.(osmLayer);
      }
    };
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
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
      />

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
              <p className="text-[10px] text-muted-foreground">
                Inget Cesium-token — 3D-byggnader kan vara begränsade
              </p>
            )}
          </CardContent>
        </Card>

        <Badge variant="secondary" className="w-fit text-xs bg-card/90 backdrop-blur-sm">
          <Building2 size={12} className="mr-1" />
          {facilities.length} byggnader
        </Badge>
      </div>

      <Button
        variant="secondary"
        size="icon"
        onClick={handleResetView}
        className="absolute top-4 right-4 z-20 bg-card/90 backdrop-blur-sm shadow-lg"
        title="Återställ vy"
      >
        <RotateCcw size={16} />
      </Button>

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
              <Globe size={14} className="text-primary" />
              Visa 360°
            </button>
          )}
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
            onClick={() => {
              const node = navigatorTreeData.find(
                n => n.fmGuid.toLowerCase() === contextMenu.facility.fm_guid.toLowerCase(),
              );
              if (node) {
                setSelectedFacility(node);
                setActiveApp('portfolio');
              }
              setContextMenu(null);
            }}
          >
            <Building2 size={14} className="text-primary" />
            Visa detaljer
          </button>
        </div>
      )}

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
