import React, { useContext, useState, useMemo } from 'react';
import { AppContext } from '@/context/AppContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Building2, Search, Layers, MapPin, Box } from 'lucide-react';

/**
 * Building Selector component shown when 3D viewer is opened without a selected building
 * Allows users to select a building to view in 3D
 */
const BuildingSelector: React.FC = () => {
  const { allData, setViewer3dFmGuid, isLoadingData } = useContext(AppContext);
  const [searchQuery, setSearchQuery] = useState('');

  // Extract buildings from allData
  const buildings = useMemo(() => {
    return allData.filter((item: any) => item.category === 'Building');
  }, [allData]);

  // Filter buildings by search query
  const filteredBuildings = useMemo(() => {
    if (!searchQuery.trim()) return buildings;
    const query = searchQuery.toLowerCase();
    return buildings.filter((building: any) => {
      const name = (building.commonName || building.name || '').toLowerCase();
      const complex = (building.complexCommonName || '').toLowerCase();
      return name.includes(query) || complex.includes(query);
    });
  }, [buildings, searchQuery]);

  // Calculate metrics for a building
  const getBuildingMetrics = (buildingFmGuid: string) => {
    const storeys = allData.filter(
      (item: any) => item.category === 'Building Storey' && item.buildingFmGuid === buildingFmGuid
    );
    const spaces = allData.filter(
      (item: any) => item.category === 'Space' && item.buildingFmGuid === buildingFmGuid
    );
    
    // Calculate total area from space attributes
    let totalArea = 0;
    spaces.forEach((space: any) => {
      const attrs = space.attributes || {};
      // Find NTA or Area attribute
      Object.keys(attrs).forEach(key => {
        if (key.toLowerCase().includes('nta') || (key.toLowerCase() === 'area' && !key.includes('per'))) {
          const val = attrs[key]?.value;
          if (typeof val === 'number') {
            totalArea += val;
          }
        }
      });
    });

    return {
      floors: storeys.length,
      rooms: spaces.length,
      area: Math.round(totalArea),
    };
  };

  const handleSelectBuilding = (fmGuid: string) => {
    setViewer3dFmGuid(fmGuid);
  };

  if (isLoadingData) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm">Laddar byggnader...</p>
        </div>
      </div>
    );
  }

  if (buildings.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Inga byggnader tillgängliga</p>
          <p className="text-xs mt-1">Synkronisera data från Asset+ för att komma igång</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Box className="h-5 w-5 text-primary" />
          Välj byggnad för 3D-visning
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Välj en byggnad nedan för att öppna dess 3D-modell
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Sök byggnad..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Building Grid */}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
          {filteredBuildings.map((building: any) => {
            const metrics = getBuildingMetrics(building.fmGuid);
            
            return (
              <Card
                key={building.fmGuid}
                className="cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 hover:scale-[1.02] active:scale-[0.98]"
                onClick={() => handleSelectBuilding(building.fmGuid)}
              >
                <CardContent className="p-4">
                  {/* Building Icon */}
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>

                  {/* Building Name */}
                  <h3 className="font-medium text-sm line-clamp-2 min-h-[2.5rem]">
                    {building.commonName || building.name || 'Namnlös byggnad'}
                  </h3>

                  {/* Complex Name */}
                  {building.complexCommonName && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <MapPin className="h-3 w-3" />
                      <span className="line-clamp-1">{building.complexCommonName}</span>
                    </div>
                  )}

                  {/* Metrics */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {metrics.floors > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <Layers className="h-3 w-3 mr-1" />
                        {metrics.floors} vån
                      </Badge>
                    )}
                    {metrics.rooms > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {metrics.rooms} rum
                      </Badge>
                    )}
                    {metrics.area > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {metrics.area.toLocaleString('sv-SE')} m²
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* No results */}
        {filteredBuildings.length === 0 && searchQuery && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Inga byggnader matchade "{searchQuery}"</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default BuildingSelector;
