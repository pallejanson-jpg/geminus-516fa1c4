/**
 * RouteDisplayOverlay — SVG overlay showing a computed route on the 2D plan.
 * Animated dashed line with start/end markers.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { RouteResult } from '@/lib/pathfinding';

interface RouteDisplayOverlayProps {
  route: RouteResult | null;
  className?: string;
}

const RouteDisplayOverlay: React.FC<RouteDisplayOverlayProps> = ({ route, className }) => {
  if (!route || route.path.length < 2) return null;

  const points = route.path.map(n => `${n.coordinates[0]},${n.coordinates[1]}`).join(' ');
  const startNode = route.path[0];
  const endNode = route.path[route.path.length - 1];

  return (
    <div className={cn('absolute inset-0 pointer-events-none', className)}>
      <svg className="absolute inset-0 w-full h-full">
        <defs>
          <marker id="route-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="hsl(var(--primary))" />
          </marker>
        </defs>

        {/* Route polyline with animated dash */}
        <polyline
          points={points}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="8 4"
          markerEnd="url(#route-arrow)"
          style={{ animation: 'route-dash 1s linear infinite' }}
        />

        {/* Route shadow for visibility on white backgrounds */}
        <polyline
          points={points}
          fill="none"
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Re-draw route on top of shadow */}
        <polyline
          points={points}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="8 4"
          style={{ animation: 'route-dash 1s linear infinite' }}
        />

        {/* Start marker */}
        <circle
          cx={`${startNode.coordinates[0]}%`}
          cy={`${startNode.coordinates[1]}%`}
          r={7}
          fill="hsl(142 71% 45%)"
          stroke="white"
          strokeWidth={2}
        />
        <text
          x={`${startNode.coordinates[0]}%`}
          y={`${startNode.coordinates[1]}%`}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="8"
          fill="white"
          fontWeight="bold"
        >
          A
        </text>

        {/* End marker */}
        <circle
          cx={`${endNode.coordinates[0]}%`}
          cy={`${endNode.coordinates[1]}%`}
          r={7}
          fill="hsl(0 84% 60%)"
          stroke="white"
          strokeWidth={2}
        />
        <text
          x={`${endNode.coordinates[0]}%`}
          y={`${endNode.coordinates[1]}%`}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="8"
          fill="white"
          fontWeight="bold"
        >
          B
        </text>

        {/* Floor transition markers */}
        {route.floorTransitions.map((ft, i) => {
          const node = route.path.find(n => n.nodeId === ft.nodeId);
          if (!node) return null;
          return (
            <g key={i}>
              <rect
                x={`${node.coordinates[0] - 1.5}%`}
                y={`${node.coordinates[1] - 1}%`}
                width="3%"
                height="2%"
                rx={3}
                fill="hsl(var(--accent))"
                stroke="white"
                strokeWidth={1}
              />
              <text
                x={`${node.coordinates[0]}%`}
                y={`${node.coordinates[1]}%`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="6"
                fill="white"
              >
                ↕
              </text>
            </g>
          );
        })}
      </svg>

      {/* Distance badge */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-card/95 backdrop-blur-sm border border-border rounded-md px-3 py-1 shadow-sm">
        <span className="text-xs text-foreground font-medium">
          {route.totalDistance.toFixed(1)} m
          {route.floorTransitions.length > 0 && (
            <span className="text-muted-foreground ml-2">
              ({route.floorTransitions.length} våningsbyte)
            </span>
          )}
        </span>
      </div>

      <style>{`
        @keyframes route-dash {
          to { stroke-dashoffset: -12; }
        }
      `}</style>
    </div>
  );
};

export default RouteDisplayOverlay;
