import React, { useState, useContext, useMemo } from 'react';
import { 
  X, MapPin, Info, BarChart, Star, Table, Layers, 
  DoorOpen, LayoutGrid, Zap, Settings2, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { useBuildingSettings } from '@/hooks/useBuildingSettings';
import { useXktPreload } from '@/hooks/useXktPreload';
import { NavigatorNode } from '@/components/navigator/TreeNode';
import KpiCard from './KpiCard';
import QuickActions from './QuickActions';
import UniversalPropertiesDialog from '@/components/common/UniversalPropertiesDialog';

interface FacilityLandingPageProps {
  facility: Facility;
  onClose: () => void;
  onEdit: (facility: Facility) => void;
  onOpenMap: () => void;
  onOpenNavigator: (facility: Facility) => void;
  onOpen360: (siteId?: string) => void;
  onShowAssets: (facility: Facility) => void;
  onShowRooms: (facility: Facility) => void;
  onShowDocs: (facility: Facility) => void;
  onShowInsights: (facility: Facility) => void;
  onOpenIoT: (facility: Facility) => void;
  onAddAsset?: (parentNode: NavigatorNode) => void;
  setSelectedFacility: (facility: Facility) => void;
}

const FacilityLandingPage: React.FC<FacilityLandingPageProps> = ({
  facility,
  onClose,
  onEdit,
  onOpenMap,
  onOpenNavigator,
  onOpen360,
  onShowAssets,
  onShowRooms,
  onShowDocs,
  onShowInsights,
  onOpenIoT,
  onAddAsset,
  setSelectedFacility
}) => {
  const { allData, setActiveApp, setViewer3dFmGuid } = useContext(AppContext);
  const [showStoreys, setShowStoreys] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [ivionSiteIdInput, setIvionSiteIdInput] = useState('');
  const [showPropertiesDialog, setShowPropertiesDialog] = useState(false);

  // Use building settings hook
  const { 
    settings, 
    isLoading: isLoadingSettings, 
    isSaving, 
    toggleFavorite, 
    updateIvionSiteId 
  } = useBuildingSettings(facility.fmGuid || null);

  // Sync ivion input with settings
  React.useEffect(() => {
    if (settings?.ivionSiteId) {
      setIvionSiteIdInput(settings.ivionSiteId);
    }
  }, [settings?.ivionSiteId]);

  const isBuilding = facility.category === 'Building';
  const isStorey = facility.category === 'Building Storey';
  const isSpace = facility.category === 'Space';

  // Preload XKT models in background when viewing a building
  // This significantly speeds up 3D viewer loading times
  const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid;
  useXktPreload(buildingGuid);

  // Get child storeys for buildings
  const childStoreys = useMemo(() => {
    if (!allData || facility.category !== 'Building') return [];
    const storeys = allData.filter(item => 
      item.category === 'Building Storey' &&
      item.buildingFmGuid === facility.fmGuid
    );
    storeys.sort((a, b) => 
      (a.commonName || a.name || '').localeCompare(
        b.commonName || b.name || '', 
        undefined, 
        { numeric: true }
      )
    );
    return storeys;
  }, [allData, facility]);

  // Get child spaces
  const childSpaces = useMemo(() => {
    if (!allData || (!isBuilding && !isStorey)) return [];
    return allData.filter(item => 
      item.category === 'Space' &&
      (isBuilding ? item.buildingFmGuid === facility.fmGuid : item.levelFmGuid === facility.fmGuid)
    );
  }, [allData, facility, isBuilding, isStorey]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    const baseArea = typeof facility.area === 'number' ? facility.area : 0;
    const areaString = baseArea > 0 ? `${baseArea.toFixed(2)} m²` : 'N/A';
    
    return {
      floors: childStoreys.length || facility.numberOfLevels || 'N/A',
      rooms: childSpaces.length || 0,
      area: areaString,
      atemp: baseArea > 0 ? `${(baseArea * 0.95).toFixed(0)} m²` : 'N/A',
      loa: baseArea > 0 ? `${(baseArea * 1.05).toFixed(0)} m²` : 'N/A',
      bia: baseArea > 0 ? `${(baseArea * 1.15).toFixed(0)} m²` : 'N/A',
      energyPerSqm: isSpace ? '85 kWh/m²' : 'N/A',
    };
  }, [facility, childSpaces, childStoreys, isSpace]);

  // Handler for 3D button - passes the building's fmGuid to viewer
  const handleToggle3D = () => {
    if (facility.fmGuid) {
      setViewer3dFmGuid(facility.fmGuid);
    }
  };

  // Handler for 2D button - passes the storey's fmGuid to viewer
  const handleToggle2D = () => {
    if (facility.fmGuid) {
      setViewer3dFmGuid(facility.fmGuid);
    }
  };

  // Handler for Add Asset button
  const handleAddAsset = () => {
    if (onAddAsset && facility.fmGuid) {
      // Convert Facility to NavigatorNode format for AddAssetDialog
      const parentNode: NavigatorNode = {
        fmGuid: facility.fmGuid,
        name: facility.name || '',
        commonName: facility.commonName || '',
        category: facility.category || 'Space',
        children: [],
      };
      onAddAsset(parentNode);
    }
  };

  // Handler for saving Ivion Site ID
  const handleSaveIvionSiteId = () => {
    updateIvionSiteId(ivionSiteIdInput || null);
  };

  const title = facility.commonName || facility.name || 'Unnamed Object';
  const subTitle = facility.designation || (isBuilding ? facility.address : 'No Designation') || facility.category || 'No Category';
  const heroImage = facility.image || (isSpace 
    ? 'https://images.unsplash.com/photo-1611048264355-27a69db69042?q=80&w=1600' 
    : 'https://images.unsplash.com/photo-1515263487990-61b07816b324?q=80&w=1600'
  );

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in duration-300 overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 h-full">
        <img src={heroImage} className="w-full h-full object-cover" alt="Object hero" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
      </div>

      {/* Close Button */}
      <div className="absolute top-3 sm:top-4 right-3 sm:right-4 z-50 flex items-center gap-2">
        <Button 
          onClick={onClose} 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 sm:h-10 sm:w-10 bg-black/30 hover:bg-black/60 backdrop-blur-sm rounded-full text-white"
        >
          <X size={18} className="sm:hidden" />
          <X size={20} className="hidden sm:block" />
        </Button>
      </div>
      
      {/* Scrollable Content */}
      <ScrollArea className="flex-1 z-10 pt-20 sm:pt-24 md:pt-32">
        <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6 lg:p-8 pb-24">
          {/* Header */}
          <header className="relative w-full shrink-0 flex items-start gap-4 sm:gap-8 text-white">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl md:text-4xl font-bold truncate">{title}</h1>
              <div className="flex items-center gap-2 text-xs sm:text-sm text-white/80 mt-1">
                <MapPin size={12} className="sm:w-3.5 sm:h-3.5 text-primary" /> 
                <span className="truncate">{subTitle}</span>
              </div>
            </div>
          </header>

          <div className="space-y-4 sm:space-y-6 mt-6 sm:mt-8">
            {/* Basic Info Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3 sm:pb-4">
                <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                  <Info size={14} className="sm:w-4 sm:h-4 text-primary" />
                  Basic Information
                </CardTitle>
                <div className="flex items-center gap-1 sm:gap-2">
                  <Button 
                    onClick={toggleFavorite} 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7 sm:h-8 sm:w-8"
                    title={settings?.isFavorite ? "Remove from favorites" : "Add to favorites"}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 size={14} className="sm:w-4 sm:h-4 animate-spin" />
                    ) : (
                      <Star size={14} className={`sm:w-4 sm:h-4 ${settings?.isFavorite ? 'text-accent fill-current' : 'text-muted-foreground'}`} />
                    )}
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setShowSettings(prev => !prev)} 
                    title="Building settings" 
                    className="h-7 w-7 sm:h-8 sm:w-8"
                  >
                    <Settings2 size={14} className={`sm:w-4 sm:h-4 ${showSettings ? 'text-primary' : ''}`} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setShowPropertiesDialog(true)} title="View all properties" className="h-7 w-7 sm:h-8 sm:w-8">
                    <Table size={14} className="sm:w-4 sm:h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-3 sm:gap-y-4 gap-x-4 sm:gap-x-6 text-sm">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Name</label>
                    <p className="font-medium truncate">{title}</p>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">
                      {isBuilding ? 'Address' : 'Designation'}
                    </label>
                    <p className="font-medium truncate">{subTitle}</p>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Category</label>
                    <p className="font-medium truncate">{facility.category || '-'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Building Settings (collapsible) */}
            {showSettings && isBuilding && (
              <Card className="animate-in fade-in duration-300">
                <CardHeader className="pb-3 sm:pb-4">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Settings2 size={14} className="sm:w-4 sm:h-4 text-primary" />
                    Building Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ivionSiteId" className="text-xs">Ivion Site ID</Label>
                      <div className="flex gap-2">
                        <Input
                          id="ivionSiteId"
                          value={ivionSiteIdInput}
                          onChange={(e) => setIvionSiteIdInput(e.target.value)}
                          placeholder="e.g. site-123"
                          className="h-8 text-sm"
                        />
                        <Button 
                          size="sm" 
                          onClick={handleSaveIvionSiteId}
                          disabled={isSaving}
                          className="h-8"
                        >
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Used for 360° viewer integration
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Show on Home Page</Label>
                      <div className="flex items-center gap-3">
                        <Button
                          variant={settings?.isFavorite ? "default" : "outline"}
                          size="sm"
                          onClick={toggleFavorite}
                          disabled={isSaving}
                          className="h-8 gap-2"
                        >
                          <Star size={14} className={settings?.isFavorite ? "fill-current" : ""} />
                          {settings?.isFavorite ? 'In Favorites' : 'Add to Favorites'}
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Favorite buildings appear on the home landing page
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KPI Cards */}
            <Card>
              <CardHeader className="pb-3 sm:pb-4">
                <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                  <BarChart size={14} className="sm:w-4 sm:h-4 text-accent" />
                  Key Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                  {isBuilding && (
                    <KpiCard 
                      title="Floors" 
                      value={kpis.floors} 
                      icon={Layers} 
                      onClick={() => setShowStoreys(prev => !prev)} 
                    />
                  )}
                  {(isBuilding || isStorey) && (
                    <KpiCard 
                      title="Rooms" 
                      value={kpis.rooms} 
                      icon={DoorOpen} 
                      onClick={() => onShowRooms(facility)} 
                    />
                  )}
                  {isSpace && (
                    <KpiCard title="Energy per m²" value={kpis.energyPerSqm} icon={Zap} />
                  )}
                  <KpiCard title="Area (NTA)" value={kpis.area} icon={LayoutGrid} />
                  <KpiCard title="Area (Atemp)" value={kpis.atemp} icon={LayoutGrid} />
                  <KpiCard title="Area (LOA)" value={kpis.loa} icon={LayoutGrid} />
                  <KpiCard title="Area (BIA)" value={kpis.bia} icon={LayoutGrid} />
                </div>
              </CardContent>
            </Card>

            {/* Storeys Carousel */}
            {isBuilding && showStoreys && (
              <div className="mt-4 sm:mt-6 animate-in fade-in duration-500">
                <h3 className="text-base sm:text-lg font-bold mb-3 sm:mb-4">Floors ({childStoreys.length})</h3>
                {childStoreys.length > 0 ? (
                  <Carousel opts={{ align: "start" }} className="w-full">
                    <CarouselContent className="-ml-2">
                      {childStoreys.map((storey) => (
                        <CarouselItem key={storey.fmGuid} className="md:basis-1/2 lg:basis-1/3 pl-2">
                          <Card
                            className="overflow-hidden group cursor-pointer hover:border-primary/50 transition-all"
                            onClick={() => setSelectedFacility(storey)}
                          >
                            <div className="h-32 sm:h-40 bg-muted relative">
                              <img
                                src="https://images.unsplash.com/photo-1600121848594-d8644e57abab?q=80&w=800&auto=format&fit=crop"
                                className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                                alt={storey.commonName}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                              <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 right-2 sm:right-3">
                                <h4 className="font-bold text-white text-sm sm:text-base truncate">{storey.commonName}</h4>
                              </div>
                            </div>
                          </Card>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    <CarouselPrevious className="hidden sm:flex -left-4" />
                    <CarouselNext className="hidden sm:flex -right-4" />
                  </Carousel>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    No floors found for this building.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <QuickActions
            facility={facility}
            ivionSiteId={settings?.ivionSiteId}
            onOpenMap={onOpenMap}
            onOpenNavigator={onOpenNavigator}
            onShowAssets={onShowAssets}
            onShowRooms={onShowRooms}
            onOpen360={onOpen360}
            onToggle3D={handleToggle3D}
            onToggle2D={handleToggle2D}
            onShowDocs={onShowDocs}
            onShowInsights={onShowInsights}
            onOpenIoT={onOpenIoT}
            onAddAsset={handleAddAsset}
          />
        </div>
      </ScrollArea>

      {/* Universal Properties Dialog */}
      <UniversalPropertiesDialog
        isOpen={showPropertiesDialog}
        onClose={() => setShowPropertiesDialog(false)}
        fmGuid={facility.fmGuid || ''}
        category={facility.category}
        onUpdate={() => {
          // Refresh data if needed
        }}
      />
    </div>
  );
};

export default FacilityLandingPage;
