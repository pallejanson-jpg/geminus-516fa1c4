import React, { useContext, useState, useMemo, useEffect } from 'react';
import { extractSpaceArea } from '@/lib/building-utils';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppContext } from '@/context/AppContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Search, Layers, MapPin, Box, Camera, Trash2, Calendar } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { LOAD_SAVED_VIEW_EVENT, LoadSavedViewDetail } from '@/lib/viewer-events';

interface SavedView {
  id: string;
  name: string;
  description: string | null;
  building_fm_guid: string;
  building_name: string | null;
  screenshot_url: string | null;
  view_mode: string;
  created_at: string;
  // Full view settings
  camera_eye: number[] | null;
  camera_look: number[] | null;
  camera_up: number[] | null;
  camera_projection: string | null;
  clip_height: number | null;
  visible_model_ids: string[] | null;
  visible_floor_ids: string[] | null;
  show_spaces: boolean | null;
  show_annotations: boolean | null;
  visualization_type: string | null;
  visualization_mock_data: boolean | null;
  section_planes: Array<{ pos: number[]; dir: number[] }> | null;
}

/**
 * Building Selector component shown when 3D viewer is opened without a selected building
 * Now includes tabs for Buildings and Saved Views
 */
const BuildingSelector: React.FC = () => {
  const { allData, setViewer3dFmGuid, isLoadingData } = useContext(AppContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('buildings');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [isLoadingViews, setIsLoadingViews] = useState(false);

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

  // Filter saved views by search query
  const filteredViews = useMemo(() => {
    if (!searchQuery.trim()) return savedViews;
    const query = searchQuery.toLowerCase();
    return savedViews.filter((view) => {
      const name = (view.name || '').toLowerCase();
      const building = (view.building_name || '').toLowerCase();
      const desc = (view.description || '').toLowerCase();
      return name.includes(query) || building.includes(query) || desc.includes(query);
    });
  }, [savedViews, searchQuery]);

  // Fetch saved views with ALL fields
  useEffect(() => {
    const fetchSavedViews = async () => {
      setIsLoadingViews(true);
      try {
        const { data, error } = await supabase
          .from('saved_views')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setSavedViews(data || []);
      } catch (err) {
        console.error('Failed to fetch saved views:', err);
      } finally {
        setIsLoadingViews(false);
      }
    };

    fetchSavedViews();
  }, []);

  // Calculate metrics for a building
  const getBuildingMetrics = (buildingFmGuid: string) => {
    const storeys = allData.filter(
      (item: any) => item.category === 'Building Storey' && item.buildingFmGuid === buildingFmGuid
    );
    const spaces = allData.filter(
      (item: any) => item.category === 'Space' && item.buildingFmGuid === buildingFmGuid
    );
    
    // Calculate total area using unified extraction
    let totalArea = 0;
    spaces.forEach((space: any) => {
      totalArea += extractSpaceArea(space);
    });

    return {
      floors: storeys.length,
      rooms: spaces.length,
      area: Math.round(totalArea),
    };
  };

  const handleSelectBuilding = (fmGuid: string) => {
    setViewer3dFmGuid(fmGuid);
    // Don't navigate away — NativeViewerPage will re-render with the new fmGuid
  };

  const handleSelectView = (view: SavedView) => {
    setViewer3dFmGuid(view.building_fm_guid);
    
    // Dispatch event with full view settings to be applied after viewer initializes
    // Use a short delay to ensure the viewer context is set up
    setTimeout(() => {
      const eventDetail: LoadSavedViewDetail = {
        viewId: view.id,
        cameraEye: view.camera_eye || [0, 50, 100],
        cameraLook: view.camera_look || [0, 0, 0],
        cameraUp: view.camera_up || [0, 1, 0],
        cameraProjection: view.camera_projection || 'perspective',
        viewMode: (view.view_mode as '2d' | '3d') || '3d',
        clipHeight: view.clip_height || 1.2,
        visibleModelIds: view.visible_model_ids || [],
        visibleFloorIds: view.visible_floor_ids || [],
        showSpaces: view.show_spaces || false,
        showAnnotations: view.show_annotations || false,
        visualizationType: view.visualization_type || 'none',
        visualizationMockData: view.visualization_mock_data || false,
      };
      
      window.dispatchEvent(new CustomEvent(LOAD_SAVED_VIEW_EVENT, { detail: eventDetail }));
      console.log('Dispatched LOAD_SAVED_VIEW_EVENT:', eventDetail);
    }, 100);
    
    toast({ title: "Loading view", description: `Opening "${view.name}"` });
  };

  const handleDeleteView = async (viewId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this saved view?')) return;
    
    try {
      // Delete from database
      const { error } = await supabase
        .from('saved_views')
        .delete()
        .eq('id', viewId);

      if (error) throw error;

      // Delete screenshot from storage (ignore errors)
      await supabase.storage
        .from('saved-view-screenshots')
        .remove([`${viewId}.png`]);

      // Update local state
      setSavedViews(prev => prev.filter(v => v.id !== viewId));
      toast({ title: "View deleted" });
    } catch (err) {
      console.error('Failed to delete view:', err);
      toast({ title: "Error", description: "Could not delete the view", variant: "destructive" });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  if (isLoadingData) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size="lg" label="Loading buildings..." />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Box className="h-5 w-5 text-primary" />
          3D Viewer
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select a building or a saved view
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="buildings" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Buildings
            <Badge variant="secondary" className="text-xs ml-1">
              {buildings.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="views" className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Saved Views
            <Badge variant="secondary" className="text-xs ml-1">
              {savedViews.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={activeTab === 'buildings' ? 'Search buildings...' : 'Search saved views...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Buildings Tab */}
        <TabsContent value="buildings" className="flex-1 min-h-0 mt-0">
          {buildings.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No buildings available</p>
                <p className="text-xs mt-1">Sync data from Asset+ to get started</p>
              </div>
            </div>
          ) : (
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

                        {/* Building Name (Complex - Building format) */}
                        <h3 className="font-medium text-sm line-clamp-2 min-h-[2.5rem]">
                          {building.complexCommonName
                            ? `${building.complexCommonName} - ${building.commonName || building.name || 'Unnamed building'}`
                            : (building.commonName || building.name || 'Unnamed building')}
                        </h3>

                        {/* Metrics */}
                        <div className="flex flex-wrap gap-2 mt-3">
                          {metrics.floors > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              <Layers className="h-3 w-3 mr-1" />
                              {metrics.floors} fl.
                            </Badge>
                          )}
                          {metrics.rooms > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {metrics.rooms} rooms
                            </Badge>
                          )}
                          {metrics.area > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {metrics.area.toLocaleString('en-US')} m²
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
                  <p className="text-sm">No buildings matched "{searchQuery}"</p>
                </div>
              )}
            </ScrollArea>
          )}
        </TabsContent>

        {/* Saved Views Tab */}
        <TabsContent value="views" className="flex-1 min-h-0 mt-0">
          {isLoadingViews ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm">Loading saved views...</p>
              </div>
            </div>
          ) : savedViews.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Camera className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No saved views</p>
                <p className="text-xs mt-1">Open a building and click "Create View" in the View menu</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
                {filteredViews.map((view) => (
                  <Card
                    key={view.id}
                    className="cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 hover:scale-[1.02] active:scale-[0.98] overflow-hidden group"
                    onClick={() => handleSelectView(view)}
                  >
                    {/* Screenshot */}
                    {view.screenshot_url ? (
                      <div className="h-32 bg-muted relative">
                        <img
                          src={view.screenshot_url}
                          alt={view.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => handleDeleteView(view.id, e)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="h-32 bg-muted flex items-center justify-center relative">
                        <Camera className="h-8 w-8 text-muted-foreground/30" />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => handleDeleteView(view.id, e)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}

                    <CardContent className="p-4">
                      {/* View Name */}
                      <h3 className="font-medium text-sm line-clamp-1">
                        {view.name}
                      </h3>

                      {/* Building Name */}
                      {view.building_name && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <Building2 className="h-3 w-3" />
                          <span className="line-clamp-1">{view.building_name}</span>
                        </div>
                      )}

                      {/* Description */}
                      {view.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {view.description}
                        </p>
                      )}

                      {/* Metadata */}
                      <div className="flex items-center gap-2 mt-3">
                        <Badge variant={view.view_mode === '2d' ? 'default' : 'secondary'} className="text-xs">
                          {view.view_mode === '2d' ? '2D' : '3D'}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(view.created_at)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* No results */}
              {filteredViews.length === 0 && searchQuery && (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No views matched "{searchQuery}"</p>
                </div>
              )}
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BuildingSelector;
