import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Building2, Layers, LayoutGrid, Split, Cuboid, Eye, Info } from 'lucide-react';
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
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heroImage = facility.image || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=600&auto=format&fit=crop';
  const title = facility.commonName || facility.name || 'Unnamed';
  const address = facility.address || facility.designation || 'No address';
  
  const handleSplitViewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (facility.fmGuid) {
      navigate(`/split-viewer?building=${facility.fmGuid}&mode=split`);
    }
  };

  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setIsHovered(true), 600);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setIsHovered(false);
  }, []);
  
  return (
    <Card 
      className="overflow-hidden cursor-pointer group transition-all duration-300 hover:shadow-xl hover:border-primary/50 hover:scale-[1.03] hover:z-10 relative"
      onClick={() => onClick(facility)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Image Section — standardized h-36 sm:h-44 */}
      <div className="relative h-36 sm:h-44 bg-muted overflow-hidden">
        <img 
          src={heroImage} 
          alt={title}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 right-2 sm:right-3">
          <h3 className="font-bold text-white text-sm sm:text-base truncate">{title}</h3>
          <div className="flex items-center gap-1 text-white/80 text-[11px] sm:text-xs mt-0.5 sm:mt-1">
            <MapPin size={12} />
            <span className="truncate">{address}</span>
          </div>
        </div>
        <Badge className="absolute top-2 sm:top-3 right-2 sm:right-3 bg-primary/90 text-primary-foreground text-[11px] sm:text-xs">
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
              <p>Open 3D + 360°</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Hover Preview Overlay (desktop only) */}
        <div className={`absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'} hidden sm:flex`}>
          <div className="grid grid-cols-3 gap-3 text-center text-white mb-2">
            <div>
              <p className="text-lg font-bold">{facility.numberOfLevels || '-'}</p>
              <p className="text-[10px] text-white/60 uppercase">Våningar</p>
            </div>
            <div>
              <p className="text-lg font-bold">{facility.numberOfSpaces || '-'}</p>
              <p className="text-[10px] text-white/60 uppercase">Rum</p>
            </div>
            <div>
              <p className="text-lg font-bold">{facility.area ? `${facility.area}` : '-'}</p>
              <p className="text-[10px] text-white/60 uppercase">m²</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" onClick={(e) => { e.stopPropagation(); onClick(facility); }}>
              <Info size={12} /> Detaljer
            </Button>
            {(facility.category === 'Building' || facility.category === 'IfcBuilding') && (
              <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5" onClick={handleSplitViewClick}>
                <Cuboid size={12} /> 3D
              </Button>
            )}
          </div>
        </div>
      </div>
      
      {/* Stats Section */}
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Layers size={14} className="sm:w-4 sm:h-4" />
            </div>
            <p className="text-xs sm:text-sm font-semibold">{facility.numberOfLevels || '-'}</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Floors</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Building2 size={14} className="sm:w-4 sm:h-4" />
            </div>
            <p className="text-xs sm:text-sm font-semibold">{facility.numberOfSpaces || '-'}</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Rooms</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <LayoutGrid size={14} className="sm:w-4 sm:h-4" />
            </div>
            <p className="text-xs sm:text-sm font-semibold">{facility.area ? `${facility.area} m²` : '-'}</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground">Area</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default FacilityCard;
