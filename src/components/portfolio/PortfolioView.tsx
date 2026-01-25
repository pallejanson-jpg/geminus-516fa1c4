import React, { useState, useContext, useMemo } from 'react';
import { Search, LayoutGrid, List, Filter, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { BUILDING_IMAGES } from '@/lib/constants';
import { NavigatorNode } from '@/components/navigator/TreeNode';
import { AddAssetDialog } from '@/components/navigator/AddAssetDialog';
import FacilityCard from './FacilityCard';
import FacilityLandingPage from './FacilityLandingPage';
import RoomsView from './RoomsView';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';

interface ComplexGroup {
  complexName: string;
  facilities: Facility[];
}

const PortfolioView: React.FC = () => {
  const { selectedFacility, setSelectedFacility, setActiveApp, navigatorTreeData, isLoadingData, allData, setViewer3dFmGuid, refreshInitialData } = useContext(AppContext);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showRoomsFor, setShowRoomsFor] = useState<Facility | null>(null);
  
  // Add Asset Dialog state
  const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
  const [addAssetParentNode, setAddAssetParentNode] = useState<NavigatorNode | null>(null);

  // Helper to extract NTA value from attributes (dynamic key names like "nta51780ACD...")
  const extractNtaFromAttributes = (attributes: Record<string, any> | undefined): number => {
    if (!attributes) return 0;
    for (const key of Object.keys(attributes)) {
      if (key.toLowerCase().startsWith('nta')) {
        const ntaObj = attributes[key];
        if (ntaObj && typeof ntaObj === 'object' && typeof ntaObj.value === 'number') {
          return ntaObj.value;
        }
      }
    }
    return 0;
  };

  // Convert navigatorTreeData (buildings) to Facility[] format
  const facilities: Facility[] = useMemo(() => {
    return navigatorTreeData.map((building, index) => {
      // Get spaces for this building from allData
      const buildingSpaces = allData.filter(
        (a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid
      );
      
      // Get storeys for this building from allData (more reliable than tree children)
      const buildingStoreys = allData.filter(
        (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === building.fmGuid
      );
      
      // Calculate total area by summing NTA from each space's attributes
      const totalArea = buildingSpaces.reduce((sum: number, space: any) => {
        const nta = extractNtaFromAttributes(space.attributes);
        return sum + nta;
      }, 0);

      return {
        fmGuid: building.fmGuid,
        name: building.name,
        commonName: building.commonName,
        category: 'Building',
        image: BUILDING_IMAGES[index % BUILDING_IMAGES.length],
        numberOfLevels: buildingStoreys.length,
        numberOfSpaces: buildingSpaces.length,
        area: Math.round(totalArea), // Round to integer
        address: building.attributes?.address || undefined,
        complexCommonName: building.complexCommonName || undefined,
      };
    });
  }, [navigatorTreeData, allData]);

  // Filter facilities based on search and category
  const filteredFacilities = useMemo(() => {
    return facilities.filter(facility => {
      const matchesSearch = 
        (facility.name?.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (facility.commonName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (facility.address?.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = categoryFilter === 'all' || facility.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [facilities, searchQuery, categoryFilter]);

  // Group filtered facilities by Complex
  const complexGroups: ComplexGroup[] = useMemo(() => {
    const grouped = new Map<string, Facility[]>();
    
    filteredFacilities.forEach(facility => {
      const complexName = facility.complexCommonName || 'Other buildings';
      if (!grouped.has(complexName)) {
        grouped.set(complexName, []);
      }
      grouped.get(complexName)!.push(facility);
    });

    // Convert to array and sort by complex name
    return Array.from(grouped.entries())
      .map(([complexName, facilities]) => ({
        complexName,
        facilities: facilities.sort((a, b) => 
          (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '')
        ),
      }))
      .sort((a, b) => {
        // Put "Other buildings" last
        if (a.complexName === 'Other buildings') return 1;
        if (b.complexName === 'Other buildings') return -1;
        return a.complexName.localeCompare(b.complexName);
      });
  }, [filteredFacilities]);

  // Handlers for FacilityLandingPage
  const handleClose = () => setSelectedFacility(null);
  const handleEdit = (facility: Facility) => console.log('Edit:', facility);
  const handleOpenMap = () => setActiveApp('map');
  const handleOpenNavigator = (facility: Facility) => setActiveApp('navigation');
  const handleOpen360 = (siteId?: string) => {
    if (siteId) {
      // Open Ivion 360 viewer in new tab with the site ID
      window.open(`https://ivion.se/site/${siteId}`, '_blank');
    } else {
      // Fallback to internal placeholder if no site ID configured
      setActiveApp('radar');
    }
  };
  const handleShowAssets = (facility: Facility) => setActiveApp('asset_plus');
  const handleShowRooms = (facility: Facility) => setShowRoomsFor(facility);
  const handleShowDocs = (facility: Facility) => setActiveApp('original_archive');
  const handleShowInsights = (facility: Facility) => setActiveApp('insights');
  const handleOpenIoT = (facility: Facility) => console.log('Open IoT:', facility);
  const handleToggleFavorite = () => {
    // Now handled by useBuildingSettings hook in FacilityLandingPage
  };

  // Handle Add Asset
  const handleAddAsset = (parentNode: NavigatorNode) => {
    setAddAssetParentNode(parentNode);
    setAddAssetDialogOpen(true);
  };

  // Handle asset created - refresh data
  const handleAssetCreated = () => {
    refreshInitialData?.();
  };

  // Get rooms for a facility
  const getRoomsForFacility = (facility: Facility) => {
    if (!allData) return [];
    const isBuilding = facility.category === 'Building';
    const isStorey = facility.category === 'Building Storey';
    
    return allData.filter((item: any) => 
      item.category === 'Space' &&
      (isBuilding ? item.buildingFmGuid === facility.fmGuid : isStorey ? item.levelFmGuid === facility.fmGuid : false)
    );
  };

  // Handle opening 3D viewer for a room
  const handleOpen3DRoom = (fmGuid: string, levelFmGuid?: string) => {
    setViewer3dFmGuid(fmGuid);
    setShowRoomsFor(null);
  };

  // Show rooms view if requested
  if (showRoomsFor) {
    return (
      <RoomsView
        facility={showRoomsFor}
        rooms={getRoomsForFacility(showRoomsFor)}
        onClose={() => setShowRoomsFor(null)}
        onOpen3D={handleOpen3DRoom}
      />
    );
  }

  // Show landing page if facility is selected
  if (selectedFacility) {
    return (
      <>
        <FacilityLandingPage
          facility={selectedFacility}
          onClose={handleClose}
          onEdit={handleEdit}
          onOpenMap={handleOpenMap}
          onOpenNavigator={handleOpenNavigator}
          onOpen360={handleOpen360}
          onShowAssets={handleShowAssets}
          onShowRooms={handleShowRooms}
          onShowDocs={handleShowDocs}
          onShowInsights={handleShowInsights}
          onOpenIoT={handleOpenIoT}
          onAddAsset={handleAddAsset}
          setSelectedFacility={setSelectedFacility}
        />
        <AddAssetDialog
          open={addAssetDialogOpen}
          onOpenChange={setAddAssetDialogOpen}
          parentNode={addAssetParentNode}
          onAssetCreated={handleAssetCreated}
        />
      </>
    );
  }

  return (
    <div className="h-full flex flex-col p-3 sm:p-4 md:p-6 overflow-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Portfolio</h1>
          <p className="text-sm text-muted-foreground">Overview of all your buildings</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search properties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter size={14} className="mr-2" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="Building">Buildings</SelectItem>
            <SelectItem value="Building Storey">Floors</SelectItem>
            <SelectItem value="Space">Rooms</SelectItem>
          </SelectContent>
        </Select>
        <div className="hidden sm:flex border rounded-md">
          <Button 
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'} 
            size="icon"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid size={16} />
          </Button>
          <Button 
            variant={viewMode === 'list' ? 'secondary' : 'ghost'} 
            size="icon"
            onClick={() => setViewMode('list')}
          >
            <List size={16} />
          </Button>
        </div>
      </div>

      {/* Stats Summary */}
      {/* Loading state */}
      {isLoadingData && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Loading buildings...</span>
        </div>
      )}

      {!isLoadingData && (
        <>
          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <Card>
              <CardContent className="pt-4 p-3 sm:p-4 sm:pt-4">
                <p className="text-xl sm:text-2xl font-bold">{facilities.length}</p>
                <p className="text-xs text-muted-foreground">Total buildings</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 p-3 sm:p-4 sm:pt-4">
                <p className="text-xl sm:text-2xl font-bold">
                  {facilities.reduce((sum, f) => sum + (typeof f.numberOfSpaces === 'number' ? f.numberOfSpaces : 0), 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total rooms</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 p-3 sm:p-4 sm:pt-4">
                <p className="text-xl sm:text-2xl font-bold">
                  {facilities.reduce((sum, f) => sum + (f.area || 0), 0).toLocaleString()} m²
                </p>
                <p className="text-xs text-muted-foreground">Total area</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 p-3 sm:p-4 sm:pt-4">
                <p className="text-xl sm:text-2xl font-bold">{complexGroups.length}</p>
                <p className="text-xs text-muted-foreground">Properties</p>
              </CardContent>
            </Card>
          </div>

          {/* Complex Groups with Carousels */}
          {complexGroups.length > 0 ? (
            <div className="space-y-6 sm:space-y-8">
              {complexGroups.map((group) => (
                <div key={group.complexName} className="space-y-3">
                  {/* Complex Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base sm:text-lg font-semibold">{group.complexName}</h2>
                      <p className="text-xs sm:text-sm text-muted-foreground">
                        {group.facilities.length} {group.facilities.length === 1 ? 'building' : 'buildings'}
                      </p>
                    </div>
                  </div>

                  {/* Carousel for buildings in this complex */}
                  <div className="relative px-2 sm:px-12">
                    <Carousel
                      opts={{
                        align: 'start',
                        loop: group.facilities.length > 3,
                      }}
                      className="w-full"
                    >
                      <CarouselContent className="-ml-2 md:-ml-4">
                        {group.facilities.map((facility) => (
                          <CarouselItem 
                            key={facility.fmGuid} 
                            className="pl-2 md:pl-4 basis-full sm:basis-1/2 lg:basis-1/3 xl:basis-1/4"
                          >
                            <FacilityCard 
                              facility={facility} 
                              onClick={setSelectedFacility} 
                            />
                          </CarouselItem>
                        ))}
                      </CarouselContent>
                      {group.facilities.length > 1 && (
                        <>
                          <CarouselPrevious className="hidden sm:flex -left-2 sm:-left-4" />
                          <CarouselNext className="hidden sm:flex -right-2 sm:-right-4" />
                        </>
                      )}
                    </Carousel>
                    
                    {/* Mobile scroll indicator */}
                    {group.facilities.length > 1 && (
                      <div className="flex sm:hidden justify-center gap-1 mt-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ChevronLeft size={14} />
                          <span>Swipe for more</span>
                          <ChevronRight size={14} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Card className="flex-1">
              <CardContent className="flex flex-col items-center justify-center h-64 text-center">
                <LayoutGrid className="h-12 w-12 text-muted-foreground mb-4" />
                <CardTitle className="mb-2">No buildings found</CardTitle>
                <CardDescription>
                  {facilities.length === 0 
                    ? 'Sync data from Asset+ to display buildings'
                    : 'Try adjusting your search filters'
                  }
                </CardDescription>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default PortfolioView;
