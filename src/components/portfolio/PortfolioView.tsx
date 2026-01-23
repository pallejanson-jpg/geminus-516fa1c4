import React, { useState, useContext, useMemo } from 'react';
import { Search, LayoutGrid, List, Filter, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { BUILDING_IMAGES } from '@/lib/constants';
import FacilityCard from './FacilityCard';
import FacilityLandingPage from './FacilityLandingPage';

const PortfolioView: React.FC = () => {
  const { selectedFacility, setSelectedFacility, setActiveApp, navigatorTreeData, isLoadingData, allData } = useContext(AppContext);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [favorites, setFavorites] = useState<string[]>([]);

  // Convert navigatorTreeData (buildings) to Facility[] format
  const facilities: Facility[] = useMemo(() => {
    return navigatorTreeData.map((building, index) => {
      // Count storeys and spaces
      const storeys = building.children || [];
      const totalSpaces = storeys.reduce((sum: number, storey: any) => {
        return sum + (storey.children?.length || 0);
      }, 0);
      
      // Calculate total area from spaces
      const totalArea = allData
        .filter((a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid)
        .reduce((sum: number, space: any) => sum + (space.grossArea || 0), 0);

      return {
        fmGuid: building.fmGuid,
        name: building.name,
        commonName: building.commonName,
        category: 'Building',
        image: BUILDING_IMAGES[index % BUILDING_IMAGES.length],
        numberOfLevels: storeys.length,
        numberOfSpaces: totalSpaces,
        area: totalArea,
        address: building.attributes?.address || undefined,
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

  // Handlers for FacilityLandingPage
  const handleClose = () => setSelectedFacility(null);
  const handleEdit = (facility: Facility) => console.log('Edit:', facility);
  const handleOpenMap = () => setActiveApp('map');
  const handleOpenNavigator = (facility: Facility) => setActiveApp('navigation');
  const handleOpen360 = (siteId?: string) => setActiveApp('radar');
  const handleShowAssets = (facility: Facility) => setActiveApp('asset_plus');
  const handleShowRooms = (facility: Facility) => console.log('Show rooms:', facility);
  const handleShowDocs = (facility: Facility) => setActiveApp('original_archive');
  const handleShowInsights = (facility: Facility) => setActiveApp('insights');
  const handleOpenIoT = (facility: Facility) => console.log('Open IoT:', facility);
  const handleToggleFavorite = () => {
    if (selectedFacility) {
      setFavorites(prev => 
        prev.includes(selectedFacility.fmGuid || '')
          ? prev.filter(id => id !== selectedFacility.fmGuid)
          : [...prev, selectedFacility.fmGuid || '']
      );
    }
  };

  // Show landing page if facility is selected
  if (selectedFacility) {
    return (
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
        isFavorite={favorites.includes(selectedFacility.fmGuid || '')}
        onToggleFavorite={handleToggleFavorite}
        setSelectedFacility={setSelectedFacility}
      />
    );
  }

  return (
    <div className="h-full flex flex-col p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Portfolio</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Översikt av alla dina byggnader</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök fastigheter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter size={14} className="mr-2" />
            <SelectValue placeholder="Kategori" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla kategorier</SelectItem>
            <SelectItem value="Building">Byggnader</SelectItem>
            <SelectItem value="Building Storey">Våningsplan</SelectItem>
            <SelectItem value="Space">Rum</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex border rounded-md">
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
          <span className="ml-2 text-muted-foreground">Laddar byggnader...</span>
        </div>
      )}

      {!isLoadingData && (
        <>
          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold">{facilities.length}</p>
                <p className="text-xs text-muted-foreground">Totalt byggnader</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold">
                  {facilities.reduce((sum, f) => sum + (typeof f.numberOfSpaces === 'number' ? f.numberOfSpaces : 0), 0)}
                </p>
                <p className="text-xs text-muted-foreground">Totalt rum</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold">
                  {facilities.reduce((sum, f) => sum + (f.area || 0), 0).toLocaleString()} m²
                </p>
                <p className="text-xs text-muted-foreground">Total area</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-2xl font-bold">{favorites.length}</p>
                <p className="text-xs text-muted-foreground">Favoriter</p>
              </CardContent>
            </Card>
          </div>

          {/* Facilities Grid */}
          {filteredFacilities.length > 0 ? (
            <div className={`grid gap-4 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
              {filteredFacilities.map(facility => (
                <FacilityCard 
                  key={facility.fmGuid} 
                  facility={facility} 
                  onClick={setSelectedFacility} 
                />
              ))}
            </div>
          ) : (
            <Card className="flex-1">
              <CardContent className="flex flex-col items-center justify-center h-64 text-center">
                <LayoutGrid className="h-12 w-12 text-muted-foreground mb-4" />
                <CardTitle className="mb-2">Inga byggnader hittades</CardTitle>
                <CardDescription>
                  {facilities.length === 0 
                    ? 'Synkronisera data från Asset+ för att visa byggnader'
                    : 'Prova att ändra dina sökfilter'
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
