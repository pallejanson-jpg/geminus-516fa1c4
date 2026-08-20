/**
 * NavGraphEditorOverlay — SVG overlay for drawing navigation graph nodes/edges
 * on top of the 2D plan image in SplitPlanView.
 */

import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { NavGraph, NavEdge } from '@/lib/pathfinding';
import { euclideanDist } from '@/lib/pathfinding';
import { useLanguage } from '@/context/LanguageContext';

type EditorMode = 'node' | 'edge' | 'room-link' | 'delete' | 'entrance';

interface NavGraphEditorOverlayProps {
  graph: NavGraph;
  onGraphChange: (graph: NavGraph) => void;
  roomLabels: Array<{ id: string; name: string; x: number; y: number }>;
  floorFmGuid?: string | null;
  className?: string;
}

const NODE_RADIUS = 5;
const SNAP_DISTANCE = 3; // % units

const NavGraphEditorOverlay: React.FC<NavGraphEditorOverlayProps> = ({
  graph,
  onGraphChange,
  roomLabels,
  floorFmGuid,
  className,
}) => {
  const [mode, setMode] = useState<EditorMode>('node');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { t } = useLanguage();

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'node' && mode !== 'entrance') return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Auto-link to nearby room label
    let roomFmGuid: string | null = null;
    for (const label of roomLabels) {
      if (euclideanDist([x, y], [label.x, label.y]) < SNAP_DISTANCE) {
        roomFmGuid = label.id;
        break;
      }
    }

    const nodeId = `nav_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newNodes = new Map(graph.nodes);
    newNodes.set(nodeId, {
      nodeId,
      coordinates: [x, y],
      room_fm_guid: roomFmGuid,
      floor_fm_guid: floorFmGuid || null,
      type: mode === 'entrance' ? 'entrance' : 'waypoint',
    });

    onGraphChange({ nodes: newNodes, edges: [...graph.edges] });
  }, [mode, graph, onGraphChange, roomLabels, floorFmGuid]);

  const handleNodeClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();

    if (mode === 'delete') {
      const newNodes = new Map(graph.nodes);
      newNodes.delete(nodeId);
      const newEdges = graph.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId);
      onGraphChange({ nodes: newNodes, edges: newEdges });
      return;
    }

    if (mode === 'edge') {
      if (!selectedNodeId) {
        setSelectedNodeId(nodeId);
      } else if (selectedNodeId !== nodeId) {
        // Create edge between selected and clicked
        const fromNode = graph.nodes.get(selectedNodeId);
        const toNode = graph.nodes.get(nodeId);
        if (fromNode && toNode) {
          // Check if edge already exists
          const exists = graph.edges.some(
            e => (e.from === selectedNodeId && e.to === nodeId) || (e.from === nodeId && e.to === selectedNodeId)
          );
          if (!exists) {
            const weight = euclideanDist(fromNode.coordinates, toNode.coordinates);
            const newEdge: NavEdge = { from: selectedNodeId, to: nodeId, weight };
            onGraphChange({ nodes: new Map(graph.nodes), edges: [...graph.edges, newEdge] });
          }
        }
        setSelectedNodeId(null);
      } else {
        setSelectedNodeId(null);
      }
      return;
    }

    if (mode === 'room-link') {
      // Find nearest room label and link
      const node = graph.nodes.get(nodeId);
      if (!node) return;
      let nearestRoom: string | null = null;
      let nearestDist = Infinity;
      for (const label of roomLabels) {
        const d = euclideanDist(node.coordinates, [label.x, label.y]);
        if (d < nearestDist) {
          nearestDist = d;
          nearestRoom = label.id;
        }
      }
      if (nearestRoom && nearestDist < SNAP_DISTANCE * 2) {
        const newNodes = new Map(graph.nodes);
        newNodes.set(nodeId, { ...node, room_fm_guid: nearestRoom });
        onGraphChange({ nodes: newNodes, edges: [...graph.edges] });
      }
      return;
    }
  }, [mode, selectedNodeId, graph, onGraphChange, roomLabels]);

  const handleEdgeClick = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    if (mode === 'delete') {
      const newEdges = graph.edges.filter((_, i) => i !== idx);
      onGraphChange({ nodes: new Map(graph.nodes), edges: newEdges });
    }
  }, [mode, graph, onGraphChange]);

  // Nodes/edges carry floor_fm_guid from whichever floor they were placed on. The
  // graph passed in here is the whole building's merged multi-floor graph, but this
  // overlay only ever shows one floor's plan image at a time — so nodes from other
  // floors must not be drawn at their raw %, that coordinate space belongs to a
  // different image entirely.
  const currentFloor = floorFmGuid ?? null;
  const sameFloor = (nf: string | null | undefined) => (nf ?? null) === currentFloor;

  const nodeArray = Array.from(graph.nodes.values());
  const currentFloorNodes = nodeArray.filter(n => sameFloor(n.floor_fm_guid));
  // Stairwells/elevators/entrances on other floors are shown dimmed as a reference
  // for cross-floor linking, but aren't interactive here — they belong to a floor
  // plan image that isn't the one currently displayed.
  const ghostNodes = nodeArray.filter(n =>
    !sameFloor(n.floor_fm_guid) && (n.type === 'stairwell' || n.type === 'elevator' || n.type === 'entrance')
  );

  // Nodes on this floor that have an edge to a node on a different floor (e.g. a
  // stairwell continuing up) get a small ring so the connection is visible even
  // though the far end can't be drawn on this floor's image.
  const crossFloorLinkedNodeIds = new Set<string>();
  for (const edge of graph.edges) {
    const fromNode = graph.nodes.get(edge.from);
    const toNode = graph.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    const fromOnFloor = sameFloor(fromNode.floor_fm_guid);
    const toOnFloor = sameFloor(toNode.floor_fm_guid);
    if (fromOnFloor && !toOnFloor) crossFloorLinkedNodeIds.add(fromNode.nodeId);
    if (toOnFloor && !fromOnFloor) crossFloorLinkedNodeIds.add(toNode.nodeId);
  }

  return (
    <div className={cn('absolute inset-0 pointer-events-none', className)}>
      {/* Mode toolbar */}
      <div
        className="absolute top-2 right-2 z-30 flex flex-col gap-1 pointer-events-auto"
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        {([
          ['node', `📍 ${t('Nod', 'Node')}`],
          ['entrance', `🚪 ${t('Entré', 'Entrance')}`],
          ['edge', `🔗 ${t('Kant', 'Edge')}`],
          ['room-link', `🏠 ${t('Rum', 'Room')}`],
          ['delete', `🗑️ ${t('Radera', 'Delete')}`],
        ] as [EditorMode, string][]).map(([m, label]) => (
          <button
            key={m}
            className={cn(
              'px-2 py-1 text-2xs rounded border transition-colors',
              mode === m
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card/90 text-foreground border-border hover:bg-accent'
            )}
            onClick={() => { setMode(m); setSelectedNodeId(null); }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* SVG overlay */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-auto"
        style={{ cursor: mode === 'node' ? 'crosshair' : mode === 'delete' ? 'not-allowed' : 'pointer' }}
        onClick={handleSvgClick}
      >
        {/* Edges — only drawn when both ends are on this floor's plan image */}
        {graph.edges.map((edge, idx) => {
          const from = graph.nodes.get(edge.from);
          const to = graph.nodes.get(edge.to);
          if (!from || !to) return null;
          if (!sameFloor(from.floor_fm_guid) || !sameFloor(to.floor_fm_guid)) return null;
          return (
            <line
              key={`edge-${idx}`}
              x1={`${from.coordinates[0]}%`}
              y1={`${from.coordinates[1]}%`}
              x2={`${to.coordinates[0]}%`}
              y2={`${to.coordinates[1]}%`}
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeOpacity={0.7}
              className="cursor-pointer"
              onClick={(e) => handleEdgeClick(e, idx)}
            />
          );
        })}

        {/* Ghost nodes — stairwells/elevators/entrances on other floors, shown for
            reference only (dimmed, non-interactive) so cross-floor links can be
            planned even though this image can't show them at the right spot. */}
        {ghostNodes.map(node => (
          <circle
            key={`ghost-${node.nodeId}`}
            cx={`${node.coordinates[0]}%`}
            cy={`${node.coordinates[1]}%`}
            r={NODE_RADIUS - 1.5}
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.4}
            className="pointer-events-none"
          />
        ))}

        {/* Nodes on this floor */}
        {currentFloorNodes.map(node => (
          <g key={node.nodeId}>
            {crossFloorLinkedNodeIds.has(node.nodeId) && (
              <circle
                cx={`${node.coordinates[0]}%`}
                cy={`${node.coordinates[1]}%`}
                r={NODE_RADIUS + 4}
                fill="none"
                stroke="hsl(var(--accent))"
                strokeWidth={1.5}
                strokeDasharray="2 2"
                className="pointer-events-none"
              />
            )}
            <circle
              cx={`${node.coordinates[0]}%`}
              cy={`${node.coordinates[1]}%`}
              r={node.type === 'entrance' ? NODE_RADIUS + 2 : NODE_RADIUS}
              fill={
                node.type === 'entrance' ? 'hsl(var(--success))' :
                node.room_fm_guid ? 'hsl(var(--accent))' : 'hsl(var(--primary))'
              }
              stroke={selectedNodeId === node.nodeId ? '#fff' : 'hsl(var(--primary-foreground))'}
              strokeWidth={selectedNodeId === node.nodeId ? 2.5 : 1.5}
              className="cursor-pointer"
              onClick={(e) => handleNodeClick(e, node.nodeId)}
            />
            {(node.type === 'stairwell' || node.type === 'elevator' || node.type === 'entrance') && (
              <text
                x={`${node.coordinates[0]}%`}
                y={`${node.coordinates[1]}%`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="7"
                fill="white"
                className="pointer-events-none"
              >
                {node.type === 'entrance' ? '🚪' : node.type === 'elevator' ? '🛗' : '🔼'}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
};

export default NavGraphEditorOverlay;
