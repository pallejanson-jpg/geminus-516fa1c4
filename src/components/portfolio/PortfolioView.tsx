import React, { useState, useContext, useMemo } from 'react';
import { Search, Plus, LayoutGrid, List, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { BUILDING_IMAGES } from '@/lib/constants';
import FacilityCard from './FacilityCard';
import FacilityLandingPage from './FacilityLandingPage';

// Mock data for demonstration
const MOCK_FACILITIES: Facility[] = [
  {
    fmGuid: '1',
    name: 'Kontorshus Centrum',
    commonName: 'Kontorshus Centrum',
    category: 'Building',
    address: 'Storgatan 1, Stockholm',
    image: BUILDING_IMAGES[0],
    numberOfLevels: 8,
    numberOfSpaces: 156,
    area: 12500,
  },
  {
    fmGuid: '2',
    name: 'Kv. Björken',
    commonName: 'Kv. Björken',
    category: 'Building',
    address: 'Björkvägen 23, Göteborg',
    image: BUILDING_IMAGES[1],
    numberOfLevels: 5,
    numberOfSpaces: 84,
    area: 7800,
  },
  {
    fmGuid: '3',
    name: 'Lagerlokaler Syd',
    commonName: 'Lagerlokaler Syd',
    category: 'Building',
    address: 'Industrivägen 45, Malmö',
    image: BUILDING_IMAGES[2],
    numberOfLevels: 2,
    numberOfSpaces: 12,
    area: 15200,
  },
  {
    fmGuid: '4',
    name: 'Affärshus Norra',
    commonName: 'Affärshus Norra',
    category: 'Building',
    address: 'Torggatan 8, Uppsala',
    image: BUILDING_IMAGES[3],
    numberOfLevels: 4,
    numberOfSpaces: 42,
    area: 5600,
  },
  {
    fmGuid: '5',
    name: 'Bostadshus Väst',
    commonName: 'Bostadshus Väst',
    category: 'Building',
    address: 'Parkgatan 12, Linköping',
    image: BUILDING_IMAGES[4],
    numberOfLevels: 6,
    numberOfSpaces: 72,
    area: 8900,
  },
  {
    fmGuid: '6',
    name: 'Teknikhuset',
    commonName: 'Teknikhuset',
    category: 'Building',
    address: 'Innovationsvägen 3, Stockholm',
    image: BUILDING_IMAGES[0],
    numberOfLevels: 10,
    numberOfSpaces: 200,
    area: 18500,
  },
];

const PortfolioView: React.FC = () => {
  const { selectedFacility, setSelectedFacility, setActiveApp } = useContext(AppContext);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [favorites, setFavorites] = useState<string[]>([]);

  // Filter facilities based on search and category
  const filteredFacilities = useMemo(() => {
    return MOCK_FACILITIES.filter(facility => {
      const matchesSearch = 
        (facility.name?.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (facility.address?.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = categoryFilter === 'all' || facility.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, categoryFilter]);

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
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <p className="text-muted-foreground">Översikt av alla dina byggnader och fastigheter</p>
        </div>
        <Button className="gap-2">
          <Plus size={16} />
          Lägg till fastighet
        </Button>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{MOCK_FACILITIES.length}</p>
            <p className="text-xs text-muted-foreground">Totalt fastigheter</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {MOCK_FACILITIES.reduce((sum, f) => sum + (typeof f.numberOfSpaces === 'number' ? f.numberOfSpaces : 0), 0)}
            </p>
            <p className="text-xs text-muted-foreground">Totalt rum</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">
              {(MOCK_FACILITIES.reduce((sum, f) => sum + (f.area || 0), 0) / 1000).toFixed(0)}k m²
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
            <CardTitle className="mb-2">Inga fastigheter hittades</CardTitle>
            <CardDescription>
              Prova att ändra dina sökfilter eller lägg till en ny fastighet
            </CardDescription>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PortfolioView;
