import React, { useState, useContext, useMemo } from 'react';
import { extractSpaceArea } from '@/lib/building-utils';
import { Search, LayoutGrid, List, Filter, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { BUILDING_IMAGES, IVION_DEFAULT_BASE_URL } from '@/lib/constants';
import { NavigatorNode } from '@/components/navigator/TreeNode';
import { AddAssetDialog } from '@/components/navigator/AddAssetDialog';
import FacilityCard from './FacilityCard';
import FacilityLandingPage from './FacilityLandingPage';
import { trackRecentBuilding } from '@/components/home/HomeLanding';
import RoomsView from './RoomsView';
import DocumentsView from './DocumentsView';
import AssetsView from './AssetsView';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { useXktPreload } from '@/hooks/useXktPreload';
import { useAllBuildingSettings } from '@/hooks/useAllBuildingSettings';

interface ComplexGroup {
  complexName: string;
  facilities: Facility[];
}

const PortfolioView: React.FC = () => {
  const { selectedFacility, setSelectedFacility, setActiveApp, navigatorTreeData, isLoadingData, allData, setViewer3dFmGuid, refreshInitialData, open360WithContext, openSenslincDashboard, appConfigs } = useContext(AppContext);
  
  // Preload XKT when a building is selected
  useXktPreload(selectedFacility?.category === 'Building' ? selectedFacility.fmGuid : null);
  
  // Fetch all building settings for hero images and favorites
  const { getHeroImage, getFavorites, settingsMap, refetch: refetchBuildingSettings } = useAllBuildingSettings();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showRoomsFor, setShowRoomsFor] = useState<Facility | null>(null);
  const [showAssetsFor, setShowAssetsFor] = useState<Facility | null>(null);
  const [showDocsFor, setShowDocsFor] = useState<Facility | null>(null);
  
  // Navigation history stack for proper back-navigation
  const [facilityHistory, setFacilityHistory] = useState<Facility[]>([]);
  
  // Add Asset Dialog state
  const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
  const [addAssetParentNode, setAddAssetParentNode] = useState<NavigatorNode | null>(null);

// extractNtaFromAttributes imported from shared module at top

  // Convert navigatorTreeData (buildings) to Facility[] format, filtering out empty duplicates
  const facilities: Facility[] = useMemo(() => {
    return navigatorTreeData.filter((building) => {
      // Show buildings that have storeys, spaces, OR at least one XKT model (newly imported)
      const hasStoreys = allData.some((a: any) => a.category === 'Building Storey' && a.buildingFmGuid === building.fmGuid);
      const hasSpaces = allData.some((a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid);
      const hasChildren = building.children && building.children.length > 0;
      return hasStoreys || hasSpaces || hasChildren;
    }).map((building, index) => {
      // Get spaces for this building from allData
      const buildingSpaces = allData.filter(
        (a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid
      );
      
      // Get storeys for this building from allData (more reliable than tree children)
      const buildingStoreys = allData.filter(
        (a: any) => a.category === 'Building Storey' && a.buildingFmGuid === building.fmGuid
      );
      
      // Calculate total area using unified extraction
      const totalArea = buildingSpaces.reduce((sum: number, space: any) => sum + extractSpaceArea(space), 0);

      // Use hero image from building_settings, with fallback to stock images
      const heroImage = getHeroImage(building.fmGuid, BUILDING_IMAGES[index % BUILDING_IMAGES.length]);

      return {
        fmGuid: building.fmGuid,
        name: building.name,
        commonName: building.commonName,
        category: 'Building',
        image: heroImage,
        numberOfLevels: buildingStoreys.length,
        numberOfSpaces: buildingSpaces.length,
        area: Math.round(totalArea), // Round to integer
        address: building.attributes?.address || undefined,
        complexCommonName: building.complexCommonName || undefined,
      };
    });
  }, [navigatorTreeData, allData, getHeroImage]);

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

  // Wrap setSelectedFacility to track history for back-navigation
  const navigateToFacility = (facility: Facility | null) => {
    if (facility && selectedFacility) {
      // Push current facility onto history stack before navigating to child
      setFacilityHistory(prev => [...prev, selectedFacility]);
    }
    // Track recent building visits for home page
    if (facility && (facility.category === 'Building' || !facility.category)) {
      trackRecentBuilding({
        fmGuid: facility.fmGuid || '',
        name: facility.commonName || facility.name || '',
        image: (facility as any).image,
      });
    }
    setSelectedFacility(facility);
  };

  // Handlers for FacilityLandingPage
  const handleClose = () => {
    if (facilityHistory.length > 0) {
      // Pop the most recent parent from history
      const parent = facilityHistory[facilityHistory.length - 1];
      setFacilityHistory(prev => prev.slice(0, -1));
      setSelectedFacility(parent);
      return;
    }

    const returnApp = typeof window !== 'undefined'
      ? sessionStorage.getItem('portfolio-return-app')
      : null;

    setSelectedFacility(null);

    if (returnApp) {
      sessionStorage.removeItem('portfolio-return-app');
      setActiveApp(returnApp);
    }
  };
  const handleEdit = (facility: Facility) => console.log('Edit:', facility);
  const handleOpenMap = () => setActiveApp('map');
  const handleOpenNavigator = (facility: Facility) => setActiveApp('navigation');
  const handleOpen360 = (siteId?: string) => {
    if (siteId && selectedFacility) {
      // Get app config from localStorage to check openMode
      // Note: Ivion is stored under 'radar' key in appConfigs
      const savedConfigs = localStorage.getItem('appConfigs');
      const appConfigs = savedConfigs ? JSON.parse(savedConfigs) : {};
      const ivionConfig = appConfigs.radar || { openMode: 'external', url: '' };
      
      // Build the full URL - use configured URL or default to ivion.se
      const baseUrl = ivionConfig.url && ivionConfig.url.trim() !== '' 
        ? ivionConfig.url.replace(/\/$/, '') // Remove trailing slash
        : IVION_DEFAULT_BASE_URL;
      // FIX: Use /?site= query parameter format instead of /site/
      const fullUrl = `${baseUrl}/?site=${siteId}`;
      
      console.log('[360+] Opening Ivion:', { siteId, openMode: ivionConfig.openMode, baseUrl, fullUrl });
      
      if (ivionConfig.openMode === 'internal') {
        // Use context-aware 360 viewer with building information
        open360WithContext({
          buildingFmGuid: selectedFacility.fmGuid || selectedFacility.buildingFmGuid,
          buildingName: selectedFacility.commonName || selectedFacility.name,
          ivionSiteId: siteId,
          ivionUrl: fullUrl,
        });
      } else {
        // Open in new browser tab (external mode)
        window.open(fullUrl, '_blank');
      }
    } else {
      // Fallback to internal placeholder if no site ID configured
      setActiveApp('radar');
    }
  };
  const handleShowAssets = (facility: Facility) => setShowAssetsFor(facility);
  const handleShowRooms = (facility: Facility) => setShowRoomsFor(facility);
  const handleShowDocs = (facility: Facility) => setShowDocsFor(facility);
  const handleShowInsights = (facility: Facility) => setActiveApp('insights');
  
  // Handle opening IoT dashboard - extract sensorDashboard URL from facility attributes or fetch from Senslinc API
  const handleOpenIoT = async (facility: Facility) => {
    const attrs = (facility as any).attributes || {};
    
    // Look for sensorDashboard or sensorURL in attributes
    const dashboardKey = Object.keys(attrs).find(k => 
      k.toLowerCase().includes('sensordashboard') || 
      k.toLowerCase().includes('sensorurl')
    );
    
    let dashboardUrl = dashboardKey && attrs[dashboardKey]?.value ? attrs[dashboardKey].value : null;
    
    // If no URL in attributes, try to fetch from Senslinc API using FM GUID
    if (!dashboardUrl && facility.fmGuid) {
      try {
        console.log('[IoT] Fetching dashboard URL from Senslinc for:', facility.fmGuid);
        const { supabase } = await import('@/integrations/supabase/client');
        const { data, error } = await supabase.functions.invoke('senslinc-query', {
          body: { action: 'get-dashboard-url', fmGuid: facility.fmGuid }
        });
        
        if (!error && data?.success && data?.data?.dashboardUrl) {
          dashboardUrl = data.data.dashboardUrl;
          console.log('[IoT] Found dashboard URL via API:', dashboardUrl);
        }
      } catch (err) {
        console.log('[IoT] Failed to fetch dashboard URL from Senslinc:', err);
      }
    }
    
    if (dashboardUrl) {
      const iotConfig = appConfigs.iot || { openMode: 'internal' };
      
      if (iotConfig.openMode === 'internal') {
        // Open in internal iframe view
        openSenslincDashboard({
          dashboardUrl,
          facilityName: facility.commonName || facility.name || 'IoT Dashboard',
          facilityFmGuid: facility.fmGuid,
        });
      } else {
        // Open in new browser tab
        window.open(dashboardUrl, '_blank');
      }
    } else {
      // No dashboard URL found - show info
      console.log('No IoT dashboard URL found for:', facility.commonName || facility.name);
      const { toast } = await import('sonner');
      toast.info('No IoT dashboard', {
        description: 'This object has no linked sensor dashboard in Asset+ or Senslinc.'
      });
    }
  };
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

  // Get assets (Instance) for a facility with deduplication
  const getAssetsForFacility = (facility: Facility) => {
    if (!allData) return [];
    const isBuilding = facility.category === 'Building';
    const isStorey = facility.category === 'Building Storey';
    const isSpace = facility.category === 'Space';
    
    const filtered = allData.filter((item: any) => 
      item.category === 'Instance' &&
      (isBuilding
        ? item.buildingFmGuid === facility.fmGuid
        : isStorey
          ? item.levelFmGuid === facility.fmGuid
          : isSpace
            ? item.inRoomFmGuid === facility.fmGuid
            : false)
    );
    
    // Deduplicate by fmGuid to prevent duplicate entries
    const seen = new Set<string>();
    return filtered.filter((item: any) => {
      const guid = item.fmGuid || item.fm_guid;
      if (!guid || seen.has(guid)) return false;
      seen.add(guid);
      return true;
    });
  };

  // Handle opening 3D viewer for a room/asset
  const handleOpen3DRoom = (fmGuid: string, levelFmGuid?: string) => {
    // Resolve building GUID: for assets/rooms the fmGuid may not be a building
    const item = allData.find((a: any) => a.fmGuid === fmGuid || a.fm_guid === fmGuid);
    const buildingGuid = item?.buildingFmGuid || item?.building_fm_guid || showAssetsFor?.fmGuid || showRoomsFor?.fmGuid || fmGuid;
    setViewer3dFmGuid(buildingGuid);
    setActiveApp('native_viewer');
    setShowRoomsFor(null);
    setShowAssetsFor(null);
    
    // Dispatch zoom-to event after a delay to allow viewer to load
    if (fmGuid !== buildingGuid) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('VIEWER_ZOOM_TO_OBJECT', { detail: { fmGuid } }));
      }, 3000);
    }
  };

  // Handle selecting a room to show its landing page
  const handleSelectRoom = (fmGuid: string) => {
    const room = allData.find((a: any) => a.fmGuid === fmGuid);
    if (room) {
      navigateToFacility({
        fmGuid: room.fmGuid,
        name: room.name,
        commonName: room.commonName,
        category: room.category || 'Space',
        levelFmGuid: room.levelFmGuid,
        buildingFmGuid: room.buildingFmGuid,
        attributes: room.attributes,
      });
      setShowRoomsFor(null);
    }
  };

  // Handle selecting an asset to show its landing page
  const handleSelectAsset = (fmGuid: string) => {
    const asset = allData.find((a: any) => a.fmGuid === fmGuid || a.fm_guid === fmGuid);
    if (asset) {
      navigateToFacility({
        fmGuid: asset.fmGuid || asset.fm_guid,
        name: asset.name,
        commonName: asset.commonName || asset.common_name,
        category: asset.category || 'Instance',
        levelFmGuid: asset.levelFmGuid || asset.level_fm_guid,
        buildingFmGuid: asset.buildingFmGuid || asset.building_fm_guid,
        attributes: asset.attributes,
      });
      setShowAssetsFor(null);
    }
  };

  // Handle placing annotation for an asset (opens 3D viewer in pick mode)
  const handlePlaceAnnotation = (asset: any) => {
    // For now, just open the 3D viewer for the asset's building
    const buildingFmGuid = asset.building_fm_guid || asset.buildingFmGuid;
    if (buildingFmGuid) {
      setViewer3dFmGuid(buildingFmGuid);
      setActiveApp('native_viewer');
    }
    setShowAssetsFor(null);
  };

  // Build favorites row
  const favoriteFacilities = useMemo(() => {
    const favGuids = getFavorites();
    return facilities.filter(f => favGuids.includes(f.fmGuid || ''));
  }, [facilities, getFavorites]);

  // Pick a hero building (first favorite, or first facility)
  const heroBuilding = useMemo(() => {
    if (favoriteFacilities.length > 0) return favoriteFacilities[0];
    if (facilities.length > 0) return facilities[0];
    return null;
  }, [favoriteFacilities, facilities]);

  // Show documents view if requested
  if (showDocsFor) {
    return (
      <DocumentsView
        facility={showDocsFor}
        onClose={() => setShowDocsFor(null)}
      />
    );
  }

  // Show assets view if requested
  if (showAssetsFor) {
    return (
      <AssetsView
        facility={showAssetsFor}
        assets={getAssetsForFacility(showAssetsFor)}
        onClose={() => setShowAssetsFor(null)}
        onOpen3D={handleOpen3DRoom}
        onPlaceAnnotation={handlePlaceAnnotation}
        onSelectAsset={handleSelectAsset}
      />
    );
  }

  // Show rooms view if requested
  if (showRoomsFor) {
    return (
      <RoomsView
        facility={showRoomsFor}
        rooms={getRoomsForFacility(showRoomsFor)}
        onClose={() => setShowRoomsFor(null)}
        onOpen3D={handleOpen3DRoom}
        onSelectRoom={handleSelectRoom}
      />
    );
  }

  // Show landing page if facility is selected
  if (selectedFacility) {
    return (
      <>
        <FacilityLandingPage
          facility={selectedFacility}
          breadcrumbs={[
            { label: 'Portfolio', onClick: () => { setFacilityHistory([]); setSelectedFacility(null); } },
            ...facilityHistory.map((f, i) => ({
              label: f.commonName || f.name || f.category || '',
              onClick: () => { const target = facilityHistory[i]; setFacilityHistory(prev => prev.slice(0, i)); setSelectedFacility(target); }
            })),
            { label: selectedFacility.commonName || selectedFacility.name || selectedFacility.category || '', onClick: () => {} }
          ]}
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
          setSelectedFacility={navigateToFacility}
          onSettingsChanged={refetchBuildingSettings}
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
    <div className="h-full flex flex-col px-3 sm:px-4 md:px-6 py-3 sm:py-4 overflow-auto">

      {/* Hero Spotlight Banner */}
      {!isLoadingData && heroBuilding && (
        <div 
          className="relative w-full h-48 sm:h-64 md:h-72 rounded-2xl overflow-hidden mb-6 cursor-pointer group"
          onClick={() => navigateToFacility(heroBuilding)}
        >
          <img 
            src={heroBuilding.image || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop'} 
            alt={heroBuilding.commonName || heroBuilding.name || ''}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
          <div className="absolute bottom-4 sm:bottom-8 left-4 sm:left-8 right-4 sm:right-8">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded bg-primary/90 text-primary-foreground text-[10px] sm:text-xs font-medium">
                ★ Featured
              </span>
            </div>
            <h2 className="text-xl sm:text-3xl md:text-4xl font-bold text-white mb-1 sm:mb-2 truncate">
              {heroBuilding.commonName || heroBuilding.name}
            </h2>
            <div className="flex items-center gap-4 text-white/70 text-xs sm:text-sm">
              <span>{heroBuilding.numberOfLevels || 0} floors</span>
              <span>{heroBuilding.numberOfSpaces || 0} rooms</span>
              <span>{heroBuilding.area ? `${heroBuilding.area.toLocaleString()} m²` : ''}</span>
            </div>
            <div className="flex gap-2 mt-3">
              <Button 
                size="sm" 
                className="h-8 gap-1.5 text-xs"
                onClick={(e) => { e.stopPropagation(); navigateToFacility(heroBuilding); }}
              >
                View details
              </Button>
              <Button 
                size="sm" 
                variant="secondary" 
                className="h-8 gap-1.5 text-xs bg-white/20 hover:bg-white/30 text-white border-0"
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (heroBuilding.fmGuid) {
                    setViewer3dFmGuid(heroBuilding.fmGuid);
                    setActiveApp('native_viewer');
                  }
                }}
              >
                Open 3D
              </Button>
            </div>
          </div>
        </div>
      )}

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <Skeleton className="h-36 w-full" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <div className="flex gap-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ))}
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

          {/* Favorites Row */}
          {favoriteFacilities.length > 0 && (
            <div className="space-y-3 mb-6 sm:mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
                    ★ My favorites
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    {favoriteFacilities.length} {favoriteFacilities.length === 1 ? 'building' : 'buildings'}
                  </p>
                </div>
              </div>
              <div className="relative px-2 sm:px-12">
                <Carousel opts={{ align: 'start', loop: false }} className="w-full">
                  <CarouselContent className="-ml-2 md:-ml-4">
                    {favoriteFacilities.map((facility) => (
                      <CarouselItem key={facility.fmGuid} className="pl-2 md:pl-4 basis-full sm:basis-1/2 lg:basis-1/3 xl:basis-1/4">
                        <FacilityCard facility={facility} onClick={navigateToFacility} />
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  {favoriteFacilities.length > 1 && (
                    <>
                      <CarouselPrevious className="hidden sm:flex -left-2 sm:-left-4" />
                      <CarouselNext className="hidden sm:flex -right-2 sm:-right-4" />
                    </>
                  )}
                </Carousel>
              </div>
            </div>
          )}

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
                        loop: false,
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
                              onClick={navigateToFacility} 
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
