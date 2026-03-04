import React from 'react';
import { Building2, Eye, ArrowRight, Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface BuildingInfoCardProps {
  name: string;
  address?: string;
  has360?: boolean;
  onViewDetails: () => void;
  onOpen3D: () => void;
  /** Additional action buttons (e.g. "Visa BIM" for Cesium) */
  extraActions?: React.ReactNode;
}

const BuildingInfoCard: React.FC<BuildingInfoCardProps> = ({
  name,
  address,
  has360,
  onViewDetails,
  onOpen3D,
  extraActions,
}) => (
  <Card className="w-[170px] sm:w-[190px] bg-card/95 backdrop-blur-md shadow-xl border-border/60 overflow-hidden">
    <CardContent className="p-2">
      <h3 className="text-[11px] sm:text-xs font-semibold text-foreground truncate">{name}</h3>
      {address && (
        <p className="text-[9px] sm:text-[10px] text-muted-foreground truncate mt-0.5">{address}</p>
      )}
      <div className="flex items-center gap-1 mt-1">
        <Badge variant="outline" className="text-[8px] sm:text-[9px] px-1 py-0 h-3.5">
          <Building2 size={8} className="mr-0.5" />
          Fastighet
        </Badge>
        {has360 && (
          <Badge variant="outline" className="text-[8px] sm:text-[9px] px-1 py-0 h-3.5 text-primary border-primary/30">
            <Globe size={8} className="mr-0.5" />
            360°
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-0.5 mt-1.5">
        <button
          className="w-full flex items-center justify-between px-1.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-primary/10 rounded transition-colors"
          onClick={onViewDetails}
        >
          <span className="flex items-center gap-1.5">
            <Building2 size={11} className="text-primary" />
            Visa detaljer
          </span>
          <ArrowRight size={10} className="text-muted-foreground" />
        </button>
        <button
          className="w-full flex items-center justify-between px-1.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-primary/10 rounded transition-colors"
          onClick={onOpen3D}
        >
          <span className="flex items-center gap-1.5">
            <Eye size={11} className="text-primary" />
            Öppna 3D-viewer
          </span>
          <ArrowRight size={10} className="text-muted-foreground" />
        </button>
        {extraActions}
      </div>
    </CardContent>
  </Card>
);

export default BuildingInfoCard;
