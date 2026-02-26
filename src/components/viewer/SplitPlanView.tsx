/**
 * SplitPlanView — Canvas-based 2D floor plan for split 2D/3D mode.
 *
 * Renders rooms (IfcSpace), walls (IfcWall/IfcWallStandardCase),
 * slabs (IfcSlab), and a camera position indicator.
 * Supports click-to-navigate, zoom/pan, and bidirectional camera sync.
 */

import React, { useRef, useEffect, useCallback, useState, useContext } from 'react';
import { cn } from '@/lib/utils';
import { AppContext } from '@/context/AppContext';
import { useFloorData } from '@/hooks/useFloorData';
import { FLOOR_SELECTION_CHANGED_EVENT } from '@/hooks/useSectionPlaneClipping';

interface SplitPlanViewProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  className?: string;
}

interface PanZoom {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const WALL_TYPES = new Set(['ifcwall', 'ifcwallstandardcase', 'ifccurtainwall']);
const SLAB_TYPES = new Set(['ifcslab']);
const SPACE_TYPES = new Set(['ifcspace']);
const COLUMN_TYPES = new Set(['ifccolumn']);
const DOOR_TYPES = new Set(['ifcdoor']);
const WINDOW_TYPES = new Set(['ifcwindow']);

const SplitPlanView: React.FC<SplitPlanViewProps> = ({ viewerRef, buildingFmGuid, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const [panZoom, setPanZoom] = useState<PanZoom>({ offsetX: 0, offsetY: 0, scale: 1 });
  const panStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const lastAabbRef = useRef<number[] | null>(null);

  // Floor data for labels
  const { floors } = useFloorData(viewerRef, buildingFmGuid);

  const getXeokitViewer = useCallback(() => {
    try {
      return viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    } catch { return null; }
  }, [viewerRef]);

  // Compute tight AABB from visible IfcSpace objects (same logic as MinimapPanel)
  const computeVisibleAabb = useCallback((scene: any, metaScene: any): number[] | null => {
    if (!metaScene?.metaObjects) return scene?.getAABB?.() || scene?.aabb || null;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasVisible = false;

    const metaObjects = metaScene.metaObjects;
    for (const id in metaObjects) {
      const mo = metaObjects[id];
      if (!mo || mo.type?.toLowerCase() !== 'ifcspace') continue;
      const obj = scene.objects?.[mo.id];
      if (!obj?.visible || !obj?.aabb) continue;
      const [ax, ay, az, bx, by, bz] = obj.aabb;
      if (ax < minX) minX = ax; if (ay < minY) minY = ay; if (az < minZ) minZ = az;
      if (bx > maxX) maxX = bx; if (by > maxY) maxY = by; if (bz > maxZ) maxZ = bz;
      hasVisible = true;
    }

    if (hasVisible && isFinite(minX)) return [minX, minY, minZ, maxX, maxY, maxZ];
    return scene?.getAABB?.() || scene?.aabb || null;
  }, []);

  // World → canvas transform
  const worldToCanvas = useCallback((wx: number, wz: number, aabb: number[], cw: number, ch: number, pz: PanZoom) => {
    const modelWidth = aabb[3] - aabb[0];
    const modelDepth = aabb[5] - aabb[2];
    const padding = 40;
    const baseScaleX = (cw - padding * 2) / modelWidth;
    const baseScaleZ = (ch - padding * 2) / modelDepth;
    const baseScale = Math.min(baseScaleX, baseScaleZ);

    const cx = padding + (cw - padding * 2 - modelWidth * baseScale) / 2;
    const cz = padding + (ch - padding * 2 - modelDepth * baseScale) / 2;

    const x = (cx + (wx - aabb[0]) * baseScale) * pz.scale + pz.offsetX;
    const z = (cz + (wz - aabb[2]) * baseScale) * pz.scale + pz.offsetY;
    return { x, z };
  }, []);

  // Canvas → world transform (inverse)
  const canvasToWorld = useCallback((cx: number, cz: number, aabb: number[], cw: number, ch: number, pz: PanZoom) => {
    const modelWidth = aabb[3] - aabb[0];
    const modelDepth = aabb[5] - aabb[2];
    const padding = 40;
    const baseScaleX = (cw - padding * 2) / modelWidth;
    const baseScaleZ = (ch - padding * 2) / modelDepth;
    const baseScale = Math.min(baseScaleX, baseScaleZ);

    const ox = padding + (cw - padding * 2 - modelWidth * baseScale) / 2;
    const oz = padding + (ch - padding * 2 - modelDepth * baseScale) / 2;

    const rawX = (cx - pz.offsetX) / pz.scale;
    const rawZ = (cz - pz.offsetY) / pz.scale;

    const worldX = aabb[0] + (rawX - ox) / baseScale;
    const worldZ = aabb[2] + (rawZ - oz) / baseScale;
    return { worldX, worldZ };
  }, []);

  // Main render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const xv = getXeokitViewer();
    if (!canvas || !container || !xv?.scene) return;

    const rect = container.getBoundingClientRect();
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * pr;
    canvas.height = rect.height * pr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(pr, pr);
    const cw = rect.width;
    const ch = rect.height;

    const scene = xv.scene;
    const metaScene = xv.metaScene;
    const aabb = computeVisibleAabb(scene, metaScene);
    if (!aabb || aabb.length < 6 || !isFinite(aabb[0])) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Laddar planvy...', cw / 2, ch / 2);
      return;
    }
    lastAabbRef.current = aabb;

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cw, ch);

    // Helper to project AABB to canvas rect
    const projectAABB = (objAABB: number[]) => {
      const tl = worldToCanvas(objAABB[0], objAABB[2], aabb, cw, ch, panZoom);
      const br = worldToCanvas(objAABB[3], objAABB[5], aabb, cw, ch, panZoom);
      return { x: tl.x, z: tl.z, w: br.x - tl.x, h: br.z - tl.z };
    };

    // Draw objects by type
    if (metaScene?.metaObjects) {
      const objects = metaScene.metaObjects;

      // 1. Draw slabs (floor plates) — very subtle
      for (const id in objects) {
        const mo = objects[id];
        if (!mo || !SLAB_TYPES.has(mo.type?.toLowerCase())) continue;
        const obj = scene.objects?.[mo.id];
        if (!obj?.visible || !obj?.aabb) continue;
        const { x, z, w, h } = projectAABB(obj.aabb);
        ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
        ctx.fillRect(x, z, w, h);
      }

      // 2. Draw spaces (rooms) — light fill, clickable
      for (const id in objects) {
        const mo = objects[id];
        if (!mo || !SPACE_TYPES.has(mo.type?.toLowerCase())) continue;
        const obj = scene.objects?.[mo.id];
        if (!obj?.visible || !obj?.aabb) continue;
        const { x, z, w, h } = projectAABB(obj.aabb);

        const isHovered = hoveredRoom === mo.id;
        const isSelected = selectedRoom === mo.id;

        ctx.fillStyle = isSelected
          ? 'rgba(59, 130, 246, 0.35)'
          : isHovered
            ? 'rgba(100, 140, 220, 0.25)'
            : 'rgba(71, 85, 105, 0.15)';
        ctx.fillRect(x, z, w, h);

        ctx.strokeStyle = isSelected
          ? 'rgba(96, 165, 250, 0.9)'
          : isHovered
            ? 'rgba(148, 163, 184, 0.6)'
            : 'rgba(100, 116, 139, 0.35)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(x, z, w, h);

        // Room label
        if (w > 35 && h > 20) {
          ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)';
          const fontSize = Math.max(9, Math.min(13, w / 8));
          ctx.font = `${fontSize}px system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const name = mo.name || '';
          const maxChars = Math.floor(w / (fontSize * 0.6));
          const display = name.length > maxChars ? name.substring(0, maxChars - 1) + '…' : name;
          ctx.fillText(display, x + w / 2, z + h / 2);
        }
      }

      // 3. Draw walls — dark solid fill
      for (const id in objects) {
        const mo = objects[id];
        if (!mo || !WALL_TYPES.has(mo.type?.toLowerCase())) continue;
        const obj = scene.objects?.[mo.id];
        if (!obj?.visible || !obj?.aabb) continue;
        const { x, z, w, h } = projectAABB(obj.aabb);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(x, z, w, h);
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, z, w, h);
      }

      // 4. Draw columns — small dark squares
      for (const id in objects) {
        const mo = objects[id];
        if (!mo || !COLUMN_TYPES.has(mo.type?.toLowerCase())) continue;
        const obj = scene.objects?.[mo.id];
        if (!obj?.visible || !obj?.aabb) continue;
        const { x, z, w, h } = projectAABB(obj.aabb);
        ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
        ctx.fillRect(x, z, w, h);
      }

      // 5. Draw doors — subtle indication
      for (const id in objects) {
        const mo = objects[id];
        if (!mo || !DOOR_TYPES.has(mo.type?.toLowerCase())) continue;
        const obj = scene.objects?.[mo.id];
        if (!obj?.visible || !obj?.aabb) continue;
        const { x, z, w, h } = projectAABB(obj.aabb);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fillRect(x, z, w, h);
      }
    }

    // Camera indicator
    const camera = xv.camera;
    if (camera?.eye && camera?.look) {
      const camPos = worldToCanvas(camera.eye[0], camera.eye[2], aabb, cw, ch, panZoom);
      const lookPos = worldToCanvas(camera.look[0], camera.look[2], aabb, cw, ch, panZoom);

      // Direction line
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(camPos.x, camPos.z);
      ctx.lineTo(lookPos.x, lookPos.z);
      ctx.stroke();

      // FOV cone
      const dx = lookPos.x - camPos.x;
      const dz = lookPos.z - camPos.z;
      const angle = Math.atan2(dz, dx);
      const coneLen = 40 * panZoom.scale;
      const coneSpread = 0.4; // radians

      ctx.fillStyle = 'rgba(96, 165, 250, 0.12)';
      ctx.beginPath();
      ctx.moveTo(camPos.x, camPos.z);
      ctx.lineTo(camPos.x + Math.cos(angle - coneSpread) * coneLen, camPos.z + Math.sin(angle - coneSpread) * coneLen);
      ctx.lineTo(camPos.x + Math.cos(angle + coneSpread) * coneLen, camPos.z + Math.sin(angle + coneSpread) * coneLen);
      ctx.closePath();
      ctx.fill();

      // Camera dot
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(camPos.x, camPos.z, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Scale indicator
    const scaleBarWorld = 10; // 10 meters
    const p1 = worldToCanvas(aabb[0], aabb[2], aabb, cw, ch, panZoom);
    const p2 = worldToCanvas(aabb[0] + scaleBarWorld, aabb[2], aabb, cw, ch, panZoom);
    const barPx = p2.x - p1.x;
    if (barPx > 20 && barPx < cw * 0.5) {
      const barY = ch - 20;
      const barX = 20;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(barX, barY); ctx.lineTo(barX + barPx, barY);
      ctx.moveTo(barX, barY - 4); ctx.lineTo(barX, barY + 4);
      ctx.moveTo(barX + barPx, barY - 4); ctx.lineTo(barX + barPx, barY + 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${scaleBarWorld}m`, barX + barPx / 2, barY - 8);
    }

    animFrameRef.current = requestAnimationFrame(render);
  }, [getXeokitViewer, panZoom, hoveredRoom, selectedRoom, computeVisibleAabb, worldToCanvas]);

  // Start/stop render loop
  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [render]);

  // Click to navigate
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const xv = getXeokitViewer();
    const aabb = lastAabbRef.current;
    const canvas = canvasRef.current;
    if (!xv || !aabb || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cz = e.clientY - rect.top;
    const { worldX, worldZ } = canvasToWorld(cx, cz, aabb, rect.width, rect.height, panZoom);
    const worldY = (aabb[1] + aabb[4]) / 2;

    if (xv.cameraFlight) {
      xv.cameraFlight.flyTo({
        eye: [worldX, xv.camera.eye[1], worldZ],
        look: [worldX, worldY, worldZ],
        up: [0, 1, 0],
        duration: 0.8,
      });
    }
  }, [getXeokitViewer, canvasToWorld, panZoom]);

  // Mouse move for room hover detection
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Pan handling
    if (panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanZoom(pz => ({ ...pz, offsetX: panStartRef.current!.ox + dx, offsetY: panStartRef.current!.oy + dy }));
      return;
    }

    // Hover detection
    const xv = getXeokitViewer();
    const aabb = lastAabbRef.current;
    const canvas = canvasRef.current;
    if (!xv || !aabb || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cz = e.clientY - rect.top;
    const { worldX, worldZ } = canvasToWorld(cx, cz, aabb, rect.width, rect.height, panZoom);

    const metaScene = xv.metaScene;
    const scene = xv.scene;
    if (!metaScene?.metaObjects) return;

    let foundRoom: string | null = null;
    for (const id in metaScene.metaObjects) {
      const mo = metaScene.metaObjects[id];
      if (!mo || mo.type?.toLowerCase() !== 'ifcspace') continue;
      const obj = scene.objects?.[mo.id];
      if (!obj?.visible || !obj?.aabb) continue;
      const [ax, , az, bx, , bz] = obj.aabb;
      if (worldX >= ax && worldX <= bx && worldZ >= az && worldZ <= bz) {
        foundRoom = mo.id;
        break;
      }
    }
    setHoveredRoom(foundRoom);
  }, [getXeokitViewer, canvasToWorld, panZoom]);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setPanZoom(pz => {
      const newScale = Math.max(0.3, Math.min(10, pz.scale * delta));
      // Zoom toward mouse position
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { ...pz, scale: newScale };
      const mx = e.clientX - rect.left;
      const mz = e.clientY - rect.top;
      const ox = mx - (mx - pz.offsetX) * (newScale / pz.scale);
      const oz = mz - (mz - pz.offsetY) * (newScale / pz.scale);
      return { offsetX: ox, offsetY: oz, scale: newScale };
    });
  }, []);

  // Pan start/end
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      panStartRef.current = { x: e.clientX, y: e.clientY, ox: panZoom.offsetX, oy: panZoom.offsetY };
    }
  }, [panZoom]);

  const handleMouseUp = useCallback(() => {
    panStartRef.current = null;
  }, []);

  // Listen for floor changes to reset pan/zoom
  useEffect(() => {
    const handler = () => {
      setPanZoom({ offsetX: 0, offsetY: 0, scale: 1 });
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full bg-[#0f172a] overflow-hidden', className)}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setHoveredRoom(null); panStartRef.current = null; }}
      />

      {/* Hovered room tooltip */}
      {hoveredRoom && (
        <div className="absolute top-3 left-3 bg-card/90 backdrop-blur-sm text-foreground text-xs px-3 py-1.5 rounded-md border border-border/50 pointer-events-none">
          {hoveredRoom}
        </div>
      )}

      {/* Zoom indicator */}
      <div className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/60 pointer-events-none">
        {Math.round(panZoom.scale * 100)}% · Alt+drag = pan · Scroll = zoom
      </div>
    </div>
  );
};

export default SplitPlanView;
