import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Building2, Layers, LayoutGrid, Split } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Facility } from '@/lib/types';

interface FacilityCardProps {
  facility: Facility;
  onClick: (facility: Facility) => void;
  showSplitViewButton?: boolean;
}

const FacilityCard: React.FC<FacilityCardProps> = ({ facility, onClick, showSplitViewButton = true }) => {
  const navigate = useNavigate();
  const heroImage = facility.image || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=600&auto=format&fit=crop';
  const title = facility.commonName || facility.name || 'Unnamed';
  const address = facility.address || facility.designation || 'No address';
  
  const handleSplitViewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (facility.fmGuid) {
      navigate(`/split-viewer?building=${facility.fmGuid}&mode=split`);
    }
  };
  
  return (
    <Card 
      className="overflow-hidden cursor-pointer group transition-all hover:shadow-lg hover:border-primary/50"
      onClick={() => onClick(facility)}
    >
      {/* Image Section */}
      <div className="relative h-32 sm:h-40 bg-muted overflow-hidden">
        <img 
          src={heroImage} 
          alt={title}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 right-2 sm:right-3">
          <h3 className="font-bold text-white text-base sm:text-lg truncate">{title}</h3>
          <div className="flex items-center gap-1 text-white/80 text-xs mt-0.5 sm:mt-1">
            <MapPin size={12} />
            <span className="truncate">{address}</span>
          </div>
        </div>
        <Badge className="absolute top-2 sm:top-3 right-2 sm:right-3 bg-primary/90 text-primary-foreground text-xs">
          {facility.category || 'Building'}
        </Badge>
        
        {/* Split View Button - only for buildings */}
        {showSplitViewButton && (facility.category === 'Building' || facility.category === 'IfcBuilding') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="absolute bottom-2 sm:bottom-3 right-2 sm:right-3 h-8 w-8 bg-background/90 hover:bg-background shadow-lg"
                onClick={handleSplitViewClick}
              >
                <Split className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Öppna 3D + 360°</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      
      {/* Stats Section */}
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Layers size={12} />
            </div>
            <p className="text-xs sm:text-sm font-semibold">{facility.numberOfLevels || '-'}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Floors</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Building2 size={12} />
            </div>
            <p className="text-xs sm:text-sm font-semibold">{facility.numberOfSpaces || '-'}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Rooms</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <LayoutGrid size={12} />
            </div>
            <p className="text-xs sm:text-sm font-semibold">{facility.area ? `${facility.area} m²` : '-'}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Area</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default FacilityCard;
