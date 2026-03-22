import React, { useContext, useEffect } from 'react';
import { AppContext } from '@/context/AppContext';
import { useRoomOptimization, type OptimizationSuggestion } from '@/hooks/useRoomOptimization';
import type { Facility } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  LayoutGrid,
  RefreshCw,
  ArrowDownUp,
  Merge,
  Minimize2,
  Maximize2,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  underutilized: { icon: <Minimize2 className="h-4 w-4" />, label: 'Underutilized' },
  overcrowded: { icon: <Maximize2 className="h-4 w-4" />, label: 'Overcrowded' },
  merge: { icon: <Merge className="h-4 w-4" />, label: 'Merge' },
  convert: { icon: <ArrowDownUp className="h-4 w-4" />, label: 'Convert' },
  rezone: { icon: <Layers className="h-4 w-4" />, label: 'Rezone' },
};

const PRIORITY_COLORS = {
  high: 'text-destructive border-destructive/30',
  medium: 'text-amber-500 border-amber-500/30',
  low: 'text-emerald-500 border-emerald-500/30',
};

function SuggestionCard({ suggestion }: { suggestion: OptimizationSuggestion }) {
  const typeConfig = TYPE_CONFIG[suggestion.type] || TYPE_CONFIG.convert;
  const priorityColor = PRIORITY_COLORS[suggestion.priority] || PRIORITY_COLORS.low;

  return (
    <Card className={cn('border', priorityColor.split(' ')[1])}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted shrink-0">{typeConfig.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-sm text-foreground">{suggestion.title}</h4>
              <Badge variant="outline" className="text-[10px]">{typeConfig.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{suggestion.description}</p>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="font-medium text-primary">{suggestion.potentialSaving}</span>
              <span>{suggestion.estimatedImpact}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RoomOptimizationTab({ facility }: { facility?: Facility }) {
  const { selectedFacility } = useContext(AppContext);
  const effectiveFacility = facility || selectedFacility;
  const { data, isLoading, error, analyze } = useRoomOptimization(effectiveFacility?.fmGuid);

  useEffect(() => {
    if (effectiveFacility?.fmGuid && !data && !isLoading) {
      analyze();
    }
  }, [effectiveFacility?.fmGuid]);

  if (!effectiveFacility) {
    return (
      <div className="text-center py-12 text-muted-foreground">
         <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-40" />
         <p>Select a building to analyze room optimization</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
           <h3 className="text-sm font-semibold text-foreground">Room Optimization</h3>
           <p className="text-xs text-muted-foreground">AI-driven analysis of space utilization</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => analyze()} disabled={isLoading}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', isLoading && 'animate-spin')} />
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </Button>
      </div>

      {isLoading && !data && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {error && !data && (
        <Card className="border-destructive/30">
          <CardContent className="p-4 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Utilization score & stats */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">Utilization Rate</span>
                <span className={cn(
                  'text-lg font-bold',
                  data.utilizationScore > 70 ? 'text-emerald-500' :
                  data.utilizationScore > 40 ? 'text-amber-500' : 'text-destructive'
                )}>
                  {data.utilizationScore}%
                </span>
              </div>
              <Progress value={data.utilizationScore} className="h-2 mb-3" />

              {data.statistics && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/50 rounded p-2">
                    <span className="text-muted-foreground">Total yta</span>
                    <span className="block font-semibold">{data.statistics.totalArea?.toLocaleString()} m²</span>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <span className="text-muted-foreground">Snittbeläggning</span>
                    <span className="block font-semibold">{data.statistics.avgOccupancy}%</span>
                  </div>
                  <div className="bg-amber-500/10 rounded p-2">
                    <span className="text-muted-foreground">Underutnyttjade</span>
                    <span className="block font-semibold text-amber-500">{data.statistics.underutilizedRooms}</span>
                  </div>
                  <div className="bg-destructive/10 rounded p-2">
                    <span className="text-muted-foreground">Överbelastade</span>
                    <span className="block font-semibold text-destructive">{data.statistics.overcrowdedRooms}</span>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground mt-2">{data.summary}</p>
            </CardContent>
          </Card>

          {/* Suggestions */}
          <div className="space-y-2">
            {data.suggestions
              ?.sort((a, b) => {
                const order = { high: 0, medium: 1, low: 2 };
                return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
              })
              .map((s, i) => (
                <SuggestionCard key={i} suggestion={s} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}
