import React, { useContext, useEffect } from 'react';
import { AppContext } from '@/context/AppContext';
import { usePredictiveMaintenance, type MaintenancePrediction } from '@/hooks/usePredictiveMaintenance';
import type { Facility } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Activity,
  RefreshCw,
  Wrench,
  Zap,
  Droplets,
  Flame,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const RISK_CONFIG = {
  high: { color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30', icon: ShieldAlert, label: 'High risk' },
  medium: { color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: AlertTriangle, label: 'Medium' },
  low: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: ShieldCheck, label: 'Low risk' },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  hvac: <Zap className="h-4 w-4" />,
  electrical: <Zap className="h-4 w-4" />,
  plumbing: <Droplets className="h-4 w-4" />,
  structural: <Building2 className="h-4 w-4" />,
  fire_safety: <Flame className="h-4 w-4" />,
  other: <Wrench className="h-4 w-4" />,
};

function PredictionCard({ prediction }: { prediction: MaintenancePrediction }) {
  const risk = RISK_CONFIG[prediction.riskLevel] || RISK_CONFIG.low;
  const RiskIcon = risk.icon;

  return (
    <Card className={cn('border', risk.border)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-lg shrink-0', risk.bg)}>
            <RiskIcon className={cn('h-5 w-5', risk.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-sm text-foreground truncate">{prediction.title}</h4>
              <Badge variant="outline" className={cn('text-[10px] shrink-0', risk.color)}>
                {risk.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{prediction.description}</p>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                {CATEGORY_ICONS[prediction.category] || CATEGORY_ICONS.other}
                {prediction.category}
              </span>
              <span>⏱ {prediction.estimatedTimeToFailure}</span>
              <span>{Math.round(prediction.confidence * 100)}% confidence</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PredictiveMaintenanceTab({ facility }: { facility?: Facility }) {
  const { selectedFacility } = useContext(AppContext);
  const effectiveFacility = facility || selectedFacility;
  const { data, isLoading, error, analyze } = usePredictiveMaintenance(effectiveFacility?.fmGuid);

  useEffect(() => {
    if (effectiveFacility?.fmGuid && !data && !isLoading) {
      analyze();
    }
  }, [effectiveFacility?.fmGuid]);

  if (!effectiveFacility) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Activity className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p>Select a building to view predictive maintenance</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Predictive Maintenance</h3>
          <p className="text-xs text-muted-foreground">AI analysis of equipment and sensors</p>
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
          <CardContent className="p-4 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Overall risk score */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">Overall risk score</span>
                <span className={cn(
                  'text-lg font-bold',
                  data.overallRiskScore > 70 ? 'text-destructive' :
                  data.overallRiskScore > 40 ? 'text-amber-500' : 'text-emerald-500'
                )}>
                  {data.overallRiskScore}/100
                </span>
              </div>
              <Progress
                value={data.overallRiskScore}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground mt-2">{data.summary}</p>
            </CardContent>
          </Card>

          {/* Predictions list */}
          <div className="space-y-2">
            {data.predictions
              .sort((a, b) => {
                const order = { high: 0, medium: 1, low: 2 };
                return (order[a.riskLevel] ?? 2) - (order[b.riskLevel] ?? 2);
              })
              .map((pred, i) => (
                <PredictionCard key={i} prediction={pred} />
              ))}
          </div>

          {data.predictions.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center">
                <Shield className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
                <p className="text-sm text-muted-foreground">No maintenance risks identified</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
