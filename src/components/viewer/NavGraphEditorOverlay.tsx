/**
 * NavGraphEditorOverlay — SVG overlay for drawing navigation graph nodes/edges
 * on top of the 2D plan image in SplitPlanView.
 */

import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { NavGraph, NavEdge } from '@/lib/pathfinding';
import { euclideanDist } from '@/lib/pathfinding';

type EditorMode = 'node' | 'edge' | 'room-link' | 'delete';

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

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'node') return;
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
      type: 'waypoint',
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

  const nodeArray = Array.from(graph.nodes.values());

  return (
    <div className={cn('absolute inset-0 pointer-events-none', className)}>
      {/* Mode toolbar */}
      <div
        className="absolute top-2 right-2 z-30 flex flex-col gap-1 pointer-events-auto"
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        {([
          ['node', '📍 Nod'],
          ['edge', '🔗 Kant'],
          ['room-link', '🏠 Rum'],
          ['delete', '🗑️ Radera'],
        ] as [EditorMode, string][]).map(([m, label]) => (
          <button
            key={m}
            className={cn(
              'px-2 py-1 text-[10px] rounded border transition-colors',
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
        {/* Edges */}
        {graph.edges.map((edge, idx) => {
          const from = graph.nodes.get(edge.from);
          const to = graph.nodes.get(edge.to);
          if (!from || !to) return null;
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

        {/* Nodes */}
        {nodeArray.map(node => (
          <g key={node.nodeId}>
            <circle
              cx={`${node.coordinates[0]}%`}
              cy={`${node.coordinates[1]}%`}
              r={NODE_RADIUS}
              fill={node.room_fm_guid ? 'hsl(var(--accent))' : 'hsl(var(--primary))'}
              stroke={selectedNodeId === node.nodeId ? '#fff' : 'hsl(var(--primary-foreground))'}
              strokeWidth={selectedNodeId === node.nodeId ? 2.5 : 1.5}
              className="cursor-pointer"
              onClick={(e) => handleNodeClick(e, node.nodeId)}
            />
            {node.type === 'stairwell' && (
              <text
                x={`${node.coordinates[0]}%`}
                y={`${node.coordinates[1]}%`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="7"
                fill="white"
                className="pointer-events-none"
              >
                🔼
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
};

export default NavGraphEditorOverlay;
