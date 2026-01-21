import React from 'react';
import { MapPin, Building2, Layers, LayoutGrid } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Facility } from '@/lib/types';

interface FacilityCardProps {
  facility: Facility;
  onClick: (facility: Facility) => void;
}

const FacilityCard: React.FC<FacilityCardProps> = ({ facility, onClick }) => {
  const heroImage = facility.image || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=600&auto=format&fit=crop';
  const title = facility.commonName || facility.name || 'Unnamed';
  const address = facility.address || facility.designation || 'No address';
  
  return (
    <Card 
      className="overflow-hidden cursor-pointer group transition-all hover:shadow-lg hover:border-primary/50"
      onClick={() => onClick(facility)}
    >
      {/* Image Section */}
      <div className="relative h-40 bg-muted overflow-hidden">
        <img 
          src={heroImage} 
          alt={title}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="font-bold text-white text-lg truncate">{title}</h3>
          <div className="flex items-center gap-1 text-white/80 text-xs mt-1">
            <MapPin size={12} />
            <span className="truncate">{address}</span>
          </div>
        </div>
        <Badge className="absolute top-3 right-3 bg-primary/90 text-primary-foreground">
          {facility.category || 'Building'}
        </Badge>
      </div>
      
      {/* Stats Section */}
      <CardContent className="p-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Layers size={12} />
            </div>
            <p className="text-sm font-semibold">{facility.numberOfLevels || '-'}</p>
            <p className="text-xs text-muted-foreground">Våningar</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Building2 size={12} />
            </div>
            <p className="text-sm font-semibold">{facility.numberOfSpaces || '-'}</p>
            <p className="text-xs text-muted-foreground">Rum</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <LayoutGrid size={12} />
            </div>
            <p className="text-sm font-semibold">{facility.area ? `${facility.area} m²` : '-'}</p>
            <p className="text-xs text-muted-foreground">Area</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default FacilityCard;
