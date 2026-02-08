import React, { useContext, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import ViewerErrorBoundary from '@/components/common/ViewerErrorBoundary';
import { AppButton } from '@/components/common/AppButton';
import { ScrollArea } from '@/components/ui/scroll-area';

// Mobile building selector component
interface MobileBuildingSelectorProps {
  onSelect: (fmGuid: string) => void;
  onClose: () => void;
}

const MobileBuildingSelector: React.FC<MobileBuildingSelectorProps> = ({ onSelect, onClose }) => {
  const { allData } = useContext(AppContext);
  
  // Extract buildings from allData
  const buildings = React.useMemo(() => {
    if (!allData) return [];
    
    const extractBuildings = (nodes: any[]): any[] => {
      const result: any[] = [];
      for (const node of nodes) {
        if (node.category === 'Building') {
          result.push(node);
        }
        if (node.children) {
          result.push(...extractBuildings(node.children));
        }
      }
      return result;
    };
    
    // allData can be an array or an object with children
    const rootNodes: any[] = Array.isArray(allData) ? allData : ((allData as any)?.children || []);
    return extractBuildings(rootNodes);
  }, [allData]);
  
  // Count floors for a building
  const getFloorCount = (building: any): number => {
    if (!building?.children) return 0;
    return building.children.filter((c: any) => c.category === 'Level').length;
  };

  return (
    <div className="h-screen w-screen bg-background flex flex-col">
      {/* Header with back button */}
      <div 
        className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur-sm"
        style={{ 
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 1rem)'
        }}
      >
        <AppButton
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-10 w-10 shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </AppButton>
        <h1 className="text-lg font-semibold">3D Viewer</h1>
      </div>
      
      {/* Building grid */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <p className="text-muted-foreground mb-4">Välj en byggnad att visa</p>
          
          {buildings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Inga byggnader tillgängliga</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {buildings.map((building) => (
                <button
                  key={building.fmGuid}
                  onClick={() => onSelect(building.fmGuid)}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/50 transition-colors text-center min-h-[100px]"
                >
                  <Building2 className="h-8 w-8 text-primary mb-2" />
                  <span className="font-medium text-sm line-clamp-2">{building.name}</span>
                  <span className="text-xs text-muted-foreground mt-1">
                    {getFloorCount(building)} våningar
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// Main Mobile 3D Viewer page
const Mobile3DViewer: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { viewer3dFmGuid } = useContext(AppContext);
  
  // Get building from URL params, context, or show selector
  const [selectedBuildingFmGuid, setSelectedBuildingFmGuid] = useState<string | null>(
    searchParams.get('building') || viewer3dFmGuid || null
  );
  
  const handleClose = () => {
    // Navigate back in history, or to home if no history
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };
  
  // Show building selector if no building selected
  if (!selectedBuildingFmGuid) {
    return (
      <MobileBuildingSelector 
        onSelect={setSelectedBuildingFmGuid} 
        onClose={handleClose} 
      />
    );
  }
  
  // Fullscreen 3D viewer - let MobileViewerOverlay handle the close button
  return (
    <div className="h-screen w-screen relative bg-background overflow-hidden" style={{ touchAction: 'none' }}>
      {/* 3D Viewer - fullscreen */}
      <ViewerErrorBoundary onReset={handleClose}>
        <AssetPlusViewer 
          fmGuid={selectedBuildingFmGuid} 
          onClose={handleClose}
        />
      </ViewerErrorBoundary>
    </div>
  );
};

export default Mobile3DViewer;
