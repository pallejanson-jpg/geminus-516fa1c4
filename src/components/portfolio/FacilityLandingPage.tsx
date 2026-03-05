import React, { useState, useContext, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, X, MapPin, Info, BarChart, Star, Table, Layers, 
  DoorOpen, LayoutGrid, Zap, Settings2, Loader2, Globe, Image, Upload, RotateCcw, ChevronRight, Eye, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { Label } from '@/components/ui/label';
import { AppContext } from '@/context/AppContext';
import { BUILDING_IMAGES } from '@/lib/constants';
import BuildingMapPicker from '@/components/map/BuildingMapPicker';
import { Facility } from '@/lib/types';
import { useBuildingSettings } from '@/hooks/useBuildingSettings';
import { useAllBuildingSettings } from '@/hooks/useAllBuildingSettings';
import { useXktPreload } from '@/hooks/useXktPreload';
import { NavigatorNode } from '@/components/navigator/TreeNode';
import KpiCard from './KpiCard';
import QuickActions from './QuickActions';
import UniversalPropertiesDialog from '@/components/common/UniversalPropertiesDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BreadcrumbItem {
  label: string;
  onClick: () => void;
}

interface FacilityLandingPageProps {
  facility: Facility;
  breadcrumbs?: BreadcrumbItem[];
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
  onSettingsChanged?: () => void;
}

const FacilityLandingPage: React.FC<FacilityLandingPageProps> = ({
  facility,
  breadcrumbs,
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
  setSelectedFacility,
  onSettingsChanged
}) => {
  const navigate = useNavigate();
  const { allData, setActiveApp, setViewer3dFmGuid, startInventory, startFaultReport, openEntityInsights } = useContext(AppContext);
  const [showStoreys, setShowStoreys] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedFloorIdx, setSelectedFloorIdx] = useState(0);
  const [roomSearch, setRoomSearch] = useState('');
  const [roomSortKey, setRoomSortKey] = useState<'name' | 'number' | 'area'>('name');

  // Saved views for this building
  const [savedViews, setSavedViews] = useState<Array<{ id: string; name: string; screenshot_url: string | null; created_at: string | null }>>([]);
  const [loadingViews, setLoadingViews] = useState(false);

  useEffect(() => {
    if (!facility.fmGuid || facility.category !== 'Building') return;
    setLoadingViews(true);
    supabase
      .from('saved_views')
      .select('id, name, screenshot_url, created_at')
      .eq('building_fm_guid', facility.fmGuid)
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => {
        setSavedViews(data || []);
        setLoadingViews(false);
      });
  }, [facility.fmGuid, facility.category]);
  const [ivionSiteIdInput, setIvionSiteIdInput] = useState('');
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [rotationInput, setRotationInput] = useState(0);
  const [showPropertiesDialog, setShowPropertiesDialog] = useState(false);
  const [isUploadingHero, setIsUploadingHero] = useState(false);
  const heroInputRef = useRef<HTMLInputElement>(null);

  // Use building settings hook
  const { 
    settings, 
    isLoading: isLoadingSettings, 
    isSaving, 
    toggleFavorite, 
    updateIvionSiteId,
    updateMapPosition,
    updateHeroImage,
    updateRotation
  } = useBuildingSettings(facility.fmGuid || null);

  // Sync ivion input with settings
  React.useEffect(() => {
    if (settings?.ivionSiteId) {
      setIvionSiteIdInput(settings.ivionSiteId);
    }
    if (settings?.latitude !== null && settings?.latitude !== undefined) {
      setLatitudeInput(String(settings.latitude));
    }
    if (settings?.longitude !== null && settings?.longitude !== undefined) {
      setLongitudeInput(String(settings.longitude));
    }
    if (settings?.rotation !== null && settings?.rotation !== undefined) {
      setRotationInput(settings.rotation);
    }
  }, [settings?.ivionSiteId, settings?.latitude, settings?.longitude, settings?.rotation]);

  const isBuilding = facility.category === 'Building';
  const isStorey = facility.category === 'Building Storey';
  const isSpace = facility.category === 'Space';

  // Preload XKT models in background when viewing a building
  // This significantly speeds up 3D viewer loading times
  const buildingGuid = isBuilding ? facility.fmGuid : (facility as any).buildingFmGuid;
  useXktPreload(buildingGuid);

  // 3D is always available — viewer loads directly from Asset+ API even without cached XKT
  const has3DModels = true;
  // Check if FM Access (2D drawings) exist for this building
  const [hasFmAccess, setHasFmAccess] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!buildingGuid) return;
    
    // Check FM Access availability via building_settings
    supabase
      .from('building_settings')
      .select('fm_access_building_guid')
      .eq('fm_guid', buildingGuid)
      .maybeSingle()
      .then(({ data }) => setHasFmAccess(!!data?.fm_access_building_guid));
  }, [buildingGuid]);

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

  // Get child assets for spaces
  const childAssets = useMemo(() => {
    if (!allData || !isSpace) return [];
    const assets = allData.filter((item: any) =>
      item.category === 'Instance' &&
      (item.in_room_fm_guid === facility.fmGuid || item.inRoomFmGuid === facility.fmGuid ||
       (item.levelFmGuid === facility.levelFmGuid && item.buildingFmGuid === facility.buildingFmGuid))
    );
    // Deduplicate
    const seen = new Set<string>();
    return assets.filter((item: any) => {
      const guid = item.fmGuid || item.fm_guid;
      if (!guid || seen.has(guid)) return false;
      seen.add(guid);
      return true;
    });
  }, [allData, facility, isSpace]);

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

  // Handler for 3D button - passes the building's fmGuid to native viewer
  const handleToggle3D = () => {
    if (facility.fmGuid) {
      onClose();
      setViewer3dFmGuid(facility.fmGuid);
      setActiveApp('native_viewer');
    }
  };

  // Handler for 2D button - passes the storey's fmGuid to viewer
  const handleToggle2D = () => {
    if (facility.fmGuid) {
      setViewer3dFmGuid(facility.fmGuid);
      setActiveApp('native_viewer');
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

  // Handler for Inventory button with prefill
  const handleInventory = (prefill: { buildingFmGuid?: string; levelFmGuid?: string; roomFmGuid?: string }) => {
    onClose();
    startInventory(prefill);
  };

  // Handler for saving Ivion Site ID
  const handleSaveIvionSiteId = () => {
    updateIvionSiteId(ivionSiteIdInput || null);
  };

  // Handler for saving map position
  const handleSaveMapPosition = () => {
    const lat = latitudeInput ? parseFloat(latitudeInput) : null;
    const lng = longitudeInput ? parseFloat(longitudeInput) : null;
    updateMapPosition(lat, lng);
  };

  // Handler for saving rotation
  const handleSaveRotation = async () => {
    await updateRotation(rotationInput);
    onSettingsChanged?.();
  };

  // Handler for showing entity insights
  const handleShowInsights = () => {
    openEntityInsights(facility);
  };

  // Handler for hero image upload
  const handleHeroImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !facility.fmGuid) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Endast bilder tillåtna');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Bilden får max vara 5 MB');
      return;
    }

    setIsUploadingHero(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `heroes/${facility.fmGuid}.${fileExt}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('inventory-images')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('inventory-images')
        .getPublicUrl(fileName);

      await updateHeroImage(urlData.publicUrl);
      toast.success('Hero-bild uppladdad!');
      // Notify parent to refresh building settings cache (global event also dispatched by the hook)
      onSettingsChanged?.();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Kunde inte ladda upp bild', {
        description: error.message,
      });
    } finally {
      setIsUploadingHero(false);
      e.target.value = '';
    }
  };

  // Fetch building settings map for hero image inheritance
  const { getHeroImage } = useAllBuildingSettings();

  const title = facility.commonName || facility.name || 'Unnamed Object';
  const subTitle = facility.designation || (isBuilding ? facility.address : 'No Designation') || facility.category || 'No Category';
  
  // For rooms/storeys, inherit building's hero image if no own image
  const buildingHero = buildingGuid ? getHeroImage(buildingGuid, '') : '';
  const heroImage = settings?.heroImageUrl || facility.image || buildingHero || (isSpace 
    ? 'https://images.unsplash.com/photo-1611048264355-27a69db69042?q=80&w=1600' 
    : 'https://images.unsplash.com/photo-1515263487990-61b07816b324?q=80&w=1600'
  );

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in duration-300 overflow-hidden w-full max-w-full">
      {/* Background Image */}
      <div className="absolute inset-0 h-full">
        <img src={heroImage} className="w-full h-full object-cover" alt="Object hero" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
      </div>

      {/* Back Button */}
      <div className="absolute top-3 sm:top-4 left-3 sm:left-4 z-50 flex items-center gap-2">
        <Button 
          onClick={onClose} 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 sm:h-10 sm:w-10 bg-black/30 hover:bg-black/60 backdrop-blur-sm rounded-full text-white"
          aria-label="Tillbaka"
        >
          <ArrowLeft size={18} className="sm:hidden" />
          <ArrowLeft size={20} className="hidden sm:block" />
        </Button>
      </div>

      {/* Top-right floating actions (always visible including mobile) */}
      <div className="absolute top-3 sm:top-4 right-3 sm:right-4 z-50 flex items-center gap-1.5">
        <Button 
          onClick={toggleFavorite} 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 bg-black/30 hover:bg-black/60 backdrop-blur-sm rounded-full text-white"
          title={settings?.isFavorite ? "Ta bort favorit" : "Lägg till favorit"}
          disabled={isSaving}
        >
          <Star size={16} className={settings?.isFavorite ? 'fill-current text-accent' : ''} />
        </Button>
        <Button 
          onClick={() => setShowSettings(prev => !prev)} 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 bg-black/30 hover:bg-black/60 backdrop-blur-sm rounded-full text-white"
          title="Inställningar"
        >
          <Settings2 size={16} className={showSettings ? 'text-primary' : ''} />
        </Button>
      </div>
      
      {/* Scrollable Content */}
      <ScrollArea className="flex-1 z-10 pt-20 sm:pt-24 md:pt-32 overflow-x-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-4 md:px-6 pb-24 w-full min-w-0 overflow-hidden">
          {/* Breadcrumb Navigation */}
          {breadcrumbs && breadcrumbs.length > 1 && (
            <nav className="flex items-center gap-1 text-xs text-white/60 mb-2 flex-wrap" aria-label="Breadcrumb">
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <React.Fragment key={i}>
                    {i > 0 && <ChevronRight size={10} className="text-white/40 shrink-0" />}
                    {isLast ? (
                      <span className="text-white/90 font-medium truncate max-w-[140px]">{crumb.label}</span>
                    ) : (
                      <button
                        onClick={crumb.onClick}
                        className="hover:text-white transition-colors truncate max-w-[120px]"
                      >
                        {crumb.label}
                      </button>
                    )}
                  </React.Fragment>
                );
              })}
            </nav>
          )}

          {/* Header */}
          <header className="relative w-full shrink-0 flex items-start gap-4 sm:gap-8 text-white min-w-0 overflow-hidden">
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
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between p-3 sm:p-6 pb-2 sm:pb-4 min-w-0">
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
              <CardContent className="px-3 sm:px-6 min-w-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-3 sm:gap-y-4 gap-x-4 sm:gap-x-6 text-sm min-w-0">
                  <div>
                    <label className="text-[11px] sm:text-xs uppercase font-bold text-muted-foreground">Name</label>
                    <p className="font-medium truncate">{title}</p>
                  </div>
                  <div>
                    <label className="text-[11px] sm:text-xs uppercase font-bold text-muted-foreground">
                      {isBuilding ? 'Address' : 'Designation'}
                    </label>
                    <p className="font-medium truncate">{subTitle}</p>
                  </div>
                  <div>
                    <label className="text-[11px] sm:text-xs uppercase font-bold text-muted-foreground">Category</label>
                    <p className="font-medium truncate">{facility.category || '-'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Building Settings (collapsible) */}
            {showSettings && isBuilding && (
              <Card className="animate-in fade-in duration-300 overflow-hidden">
                <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Settings2 size={14} className="sm:w-4 sm:h-4 text-primary" />
                    Building Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-3 sm:px-6">
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
                      <p className="text-[11px] sm:text-xs text-muted-foreground">
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
                      <p className="text-[11px] sm:text-xs text-muted-foreground">
                        Favorite buildings appear on the home landing page
                      </p>
                    </div>
                  </div>
                  
                  {/* Map Position Settings with Interactive Picker */}
                  <div className="border-t pt-4">
                    <Label className="text-xs flex items-center gap-2 mb-3">
                      <Globe size={12} />
                      Map Position
                    </Label>
                    
                    {/* Interactive Map Picker */}
                    <BuildingMapPicker
                      latitude={settings?.latitude ?? null}
                      longitude={settings?.longitude ?? null}
                      onPositionChange={(lat, lng) => {
                        setLatitudeInput(lat.toFixed(6));
                        setLongitudeInput(lng.toFixed(6));
                      }}
                      className="mb-3"
                    />
                    
                    {/* Coordinate display and save */}
                    <div className="flex items-center justify-between gap-2 bg-muted/30 rounded-md p-2">
                      <div className="text-xs text-muted-foreground">
                        {latitudeInput && longitudeInput ? (
                          <span>
                            {parseFloat(latitudeInput).toFixed(4)}, {parseFloat(longitudeInput).toFixed(4)}
                          </span>
                        ) : (
                          <span className="italic">Ingen position satt</span>
                        )}
                      </div>
                      <Button 
                        size="sm" 
                        onClick={handleSaveMapPosition}
                        disabled={isSaving || (!latitudeInput && !longitudeInput)}
                        className="h-7 text-xs"
                      >
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Spara'}
                      </Button>
                    </div>
                  </div>

                  {/* Rotation Settings for 3D/360° sync */}
                  <div className="border-t pt-4">
                    <Label className="text-xs flex items-center gap-2 mb-3">
                      <RotateCcw size={12} />
                      Rotation (för 3D/360° synk)
                    </Label>
                    
                    <div className="space-y-3">
                      <div className="flex items-center gap-4">
                        <Slider
                          value={[rotationInput]}
                          onValueChange={(values) => setRotationInput(values[0])}
                          min={0}
                          max={360}
                          step={1}
                          className="flex-1"
                        />
                        <div className="w-16 text-sm font-medium text-right">
                          {rotationInput}°
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between gap-2 bg-muted/30 rounded-md p-2">
                        <p className="text-[11px] sm:text-xs text-muted-foreground">
                          Byggnadens orientering relativt norr
                        </p>
                        <Button 
                          size="sm" 
                          onClick={handleSaveRotation}
                          disabled={isSaving || rotationInput === (settings?.rotation ?? 0)}
                          className="h-7 text-xs"
                        >
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Spara'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Hero Image Settings */}
                  <div className="border-t pt-4">
                    <Label className="text-xs flex items-center gap-2 mb-3">
                      <Image size={12} />
                      Hero Image
                    </Label>
                    
                    {settings?.heroImageUrl ? (
                      <div className="relative rounded-lg overflow-hidden border mb-2">
                        <img 
                          src={settings.heroImageUrl} 
                          alt="Building hero" 
                          className="w-full h-32 object-cover"
                        />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2 h-7 w-7"
                          onClick={() => updateHeroImage(null)}
                          disabled={isSaving}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2 mb-2">
                        <Button
                          variant="outline"
                          className="flex-1 h-16 flex-col gap-1"
                          onClick={() => heroInputRef.current?.click()}
                          disabled={isUploadingHero}
                        >
                          {isUploadingHero ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <>
                              <Upload className="h-5 w-5" />
                              <span className="text-xs">Ladda upp bild</span>
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                    
                    <p className="text-[11px] sm:text-xs text-muted-foreground">
                      Visas som bakgrundsbild på byggnadens landningssida
                    </p>
                    
                    <input
                      ref={heroInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleHeroImageUpload}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KPI Cards */}
            <Card className="overflow-hidden">
              <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
                <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                  <BarChart size={14} className="sm:w-4 sm:h-4 text-accent" />
                  Key Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1 sm:gap-3">
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

            {/* Series-style Floor Tabs + Room Grid */}
            {isBuilding && childStoreys.length > 0 && (
              <div className="mt-4 sm:mt-6 animate-in fade-in duration-500">
                <h3 className="text-base sm:text-lg font-bold mb-3 sm:mb-4">Våningar ({childStoreys.length})</h3>
                
                {/* Floor hero-image carousel */}
                <Carousel opts={{ align: 'start', dragFree: true }} className="mb-4">
                  <CarouselContent className="-ml-2">
                    {childStoreys.map((storey, idx) => {
                      // Stable pseudo-random image based on fmGuid hash
                      const hash = (storey.fmGuid || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                      const img = BUILDING_IMAGES[hash % BUILDING_IMAGES.length];
                      const isSelected = selectedFloorIdx === idx;
                      return (
                        <CarouselItem key={storey.fmGuid} className="pl-2 basis-auto">
                          <button
                            type="button"
                            onClick={() => setSelectedFloorIdx(idx)}
                            className={`relative w-36 h-24 rounded-xl overflow-hidden transition-all ${
                              isSelected ? 'ring-2 ring-primary shadow-lg scale-[1.02]' : 'opacity-80 hover:opacity-100'
                            }`}
                          >
                            <img src={img} alt="" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                            <span className="absolute bottom-1.5 left-2 right-2 text-[11px] font-semibold text-white truncate">
                              {storey.commonName || storey.name || `Våning ${idx + 1}`}
                            </span>
                          </button>
                        </CarouselItem>
                      );
                    })}
                  </CarouselContent>
                </Carousel>

                {/* Room grid - "Episode" cards for selected floor */}
                {(() => {
                  const selectedStorey = childStoreys[selectedFloorIdx];
                  if (!selectedStorey) return null;
                  let floorSpaces = allData.filter(
                    (item: any) => item.category === 'Space' && item.levelFmGuid === selectedStorey.fmGuid
                  );

                  // Extract room number helper
                  const getRoomNumber = (space: any): string => {
                    const attrs = space.attributes || {};
                    return attrs.roomNumber || attrs.RoomNumber || attrs.designation || space.name || '';
                  };

                  // Search filter
                  if (roomSearch) {
                    const q = roomSearch.toLowerCase();
                    floorSpaces = floorSpaces.filter((s: any) =>
                      (s.commonName || '').toLowerCase().includes(q) ||
                      (s.name || '').toLowerCase().includes(q) ||
                      getRoomNumber(s).toLowerCase().includes(q)
                    );
                  }

                  // Sort
                  floorSpaces = [...floorSpaces].sort((a: any, b: any) => {
                    if (roomSortKey === 'number') return getRoomNumber(a).localeCompare(getRoomNumber(b), undefined, { numeric: true });
                    if (roomSortKey === 'area') {
                      const areaA = a.grossArea || 0;
                      const areaB = b.grossArea || 0;
                      return areaB - areaA;
                    }
                    return (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '', undefined, { numeric: true });
                  });
                  
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          {floorSpaces.length} rum på {selectedStorey.commonName || selectedStorey.name}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => setSelectedFacility({
                            fmGuid: selectedStorey.fmGuid,
                            name: selectedStorey.name,
                            commonName: selectedStorey.commonName,
                            category: 'Building Storey',
                            buildingFmGuid: facility.fmGuid,
                          })}
                        >
                          Visa alla detaljer <ChevronRight size={12} />
                        </Button>
                      </div>

                      {/* Search + Sort controls */}
                      <div className="flex gap-2 items-center flex-wrap">
                        <div className="relative flex-1 min-w-[120px] max-w-[200px] sm:max-w-[240px]">
                          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={roomSearch}
                            onChange={(e) => setRoomSearch(e.target.value)}
                            placeholder="Sök rum..."
                            className="h-7 pl-8 text-xs"
                          />
                        </div>
                        <div className="flex gap-1">
                          {([['name', 'Namn'], ['number', 'Nr'], ['area', 'Yta']] as const).map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setRoomSortKey(key)}
                              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                roomSortKey === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      {floorSpaces.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1 sm:gap-3 min-w-0">
                          {floorSpaces.slice(0, 20).map((space: any) => {
                            const spaceArea = space.attributes ? 
                              Object.keys(space.attributes).find(k => k.toLowerCase().startsWith('nta')) : null;
                            const areaVal = spaceArea && space.attributes[spaceArea]?.value;
                            const roomNum = getRoomNumber(space);
                            return (
                              <button
                                key={space.fmGuid}
                                type="button"
                                onClick={() => setSelectedFacility({
                                  fmGuid: space.fmGuid,
                                  name: space.name,
                                  commonName: space.commonName,
                                  category: 'Space',
                                  levelFmGuid: space.levelFmGuid,
                                  buildingFmGuid: space.buildingFmGuid,
                                  attributes: space.attributes,
                                })}
                                className="w-full min-w-0 rounded-xl border border-border bg-card/80 p-2 sm:p-3 text-left transition-all hover:border-primary/50 hover:shadow-md active:scale-[0.98] group overflow-hidden"
                              >
                                <div className="flex items-center gap-2 mb-1.5">
                                  <DoorOpen size={14} className="text-primary shrink-0" />
                                  <span className="font-medium text-xs sm:text-sm truncate">
                                    {space.commonName || space.name || '(namnlöst)'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-muted-foreground gap-1">
                                  {roomNum && <span className="font-mono truncate">{roomNum}</span>}
                                  <span className="shrink-0">{areaVal ? `${typeof areaVal === 'number' ? areaVal.toFixed(1) : areaVal} m²` : ''}</span>
                                </div>
                              </button>
                            );
                          })}
                          {floorSpaces.length > 20 && (
                            <button
                              type="button"
                              onClick={() => onShowRooms(facility)}
                              className="rounded-xl border border-dashed border-border bg-muted/30 p-3 flex items-center justify-center text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                            >
                              +{floorSpaces.length - 20} fler rum
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground py-6 text-sm">
                          {roomSearch ? 'Inga rum matchade sökningen' : 'Inga rum registrerade på denna våning'}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Assets list for Space (Room) pages */}
          {isSpace && childAssets.length > 0 && (
            <Card className="mt-4 sm:mt-6">
              <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
                <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                  <Layers size={14} className="sm:w-4 sm:h-4 text-primary" />
                  Tillgångar ({childAssets.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 sm:gap-3">
                  {childAssets.slice(0, 20).map((asset: any) => (
                    <button
                      key={asset.fmGuid || asset.fm_guid}
                      type="button"
                      onClick={() => setSelectedFacility({
                        fmGuid: asset.fmGuid || asset.fm_guid,
                        name: asset.name,
                        commonName: asset.commonName || asset.common_name,
                        category: 'Instance',
                        levelFmGuid: asset.levelFmGuid || asset.level_fm_guid,
                        buildingFmGuid: asset.buildingFmGuid || asset.building_fm_guid,
                        attributes: asset.attributes,
                      })}
                      className="rounded-xl border border-border bg-card/80 p-2 sm:p-3 text-left transition-all hover:border-primary/50 hover:shadow-md active:scale-[0.98] group overflow-hidden"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Layers size={14} className="text-accent shrink-0" />
                        <span className="font-medium text-xs sm:text-sm truncate">
                          {asset.commonName || asset.common_name || asset.name || '(namnlös)'}
                        </span>
                      </div>
                      <div className="text-[10px] sm:text-[11px] text-muted-foreground truncate">
                        {asset.asset_type || asset.assetType || asset.category || ''}
                      </div>
                    </button>
                  ))}
                  {childAssets.length > 20 && (
                    <button
                      type="button"
                      onClick={() => onShowAssets(facility)}
                      className="rounded-xl border border-dashed border-border bg-muted/30 p-3 flex items-center justify-center text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                      +{childAssets.length - 20} fler
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <QuickActions
            facility={facility}
            ivionSiteId={settings?.ivionSiteId}
            has3DModels={has3DModels}
            hasFmAccess={hasFmAccess}
            isLoading={isLoadingSettings}
            onOpenMap={onOpenMap}
            onOpenNavigator={onOpenNavigator}
            onShowAssets={onShowAssets}
            onShowRooms={onShowRooms}
            onOpen360={onOpen360}
            onToggle3D={handleToggle3D}
            onToggle2D={handleToggle2D}
            onShowDocs={onShowDocs}
            onShowInsights={handleShowInsights}
            onOpenIoT={onOpenIoT}
            onAddAsset={handleAddAsset}
            onInventory={handleInventory}
            onOpenSplitView={(f) => {
              navigate(`/split-viewer?building=${f.fmGuid}&mode=split`);
            }}
            onFaultReport={(f) => {
              onClose();
              startFaultReport({
                buildingFmGuid: isBuilding ? f.fmGuid : (f as any).buildingFmGuid,
                buildingName: f.commonName || f.name || undefined,
                spaceFmGuid: isSpace ? f.fmGuid : undefined,
                spaceName: isSpace ? (f.commonName || f.name || undefined) : undefined,
              });
            }}
          />

          {/* Saved Views */}
          {isBuilding && savedViews.length > 0 && (
           <Card className="mt-4 sm:mt-6">
              <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
                <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                  <Eye size={14} className="sm:w-4 sm:h-4 text-primary" />
                  Sparade vyer
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                  {savedViews.map(view => (
                    <button
                      key={view.id}
                      type="button"
                      onClick={handleToggle3D}
                      className="rounded-xl border border-border bg-card/80 overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-lg active:scale-[0.98] group"
                    >
                      <div className="h-24 sm:h-28 relative overflow-hidden bg-muted">
                        {view.screenshot_url ? (
                          <img src={view.screenshot_url} alt={view.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Eye className="h-6 w-6 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-1.5 left-2 right-2">
                          <h4 className="font-semibold text-white text-xs truncate">{view.name}</h4>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>

      {/* Universal Properties Dialog */}
      <UniversalPropertiesDialog
        isOpen={showPropertiesDialog}
        onClose={() => setShowPropertiesDialog(false)}
        fmGuids={facility.fmGuid || ''}
        category={facility.category}
        onUpdate={() => {
          // Refresh data if needed
        }}
      />
    </div>
  );
};

export default FacilityLandingPage;
