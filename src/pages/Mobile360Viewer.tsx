import React, { useContext, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import Ivion360View from '@/components/viewer/Ivion360View';
import { AppButton } from '@/components/common/AppButton';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';
import { ScrollArea } from '@/components/ui/scroll-area';

// Mobile building selector component
interface MobileBuildingSelectorProps {
  onSelect: (fmGuid: string, ivionSiteId: string) => void;
  onClose: () => void;
}

const MobileBuildingSelector: React.FC<MobileBuildingSelectorProps> = ({ onSelect, onClose }) => {
  const { allData } = useContext(AppContext);
  
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
    
    const rootNodes: any[] = Array.isArray(allData) ? allData : ((allData as any)?.children || []);
    return extractBuildings(rootNodes);
  }, [allData]);

  return (
    <div className="h-screen w-screen bg-background flex flex-col">
      <div 
        className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur-sm"
        style={{ 
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 1rem)'
        }}
      >
        <AppButton variant="ghost" size="icon" onClick={onClose} className="h-10 w-10 shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </AppButton>
        <h1 className="text-lg font-semibold">360° Viewer</h1>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4">
          <p className="text-muted-foreground mb-4">Select a building to view</p>
          
          {buildings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No buildings available</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {buildings.map((building) => (
                <button
                  key={building.fmGuid}
                  onClick={() => onSelect(building.fmGuid, '')}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/50 transition-colors text-center min-h-[100px]"
                >
                  <Building2 className="h-8 w-8 text-primary mb-2" />
                  <span className="font-medium text-sm line-clamp-2">{building.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

const Mobile360Viewer: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { ivion360Context, appConfigs } = useContext(AppContext);
  
  const [selectedBuilding, setSelectedBuilding] = useState<{ fmGuid: string; ivionSiteId: string } | null>(() => {
    const building = searchParams.get('building');
    const siteId = searchParams.get('siteId');
    if (building && siteId) return { fmGuid: building, ivionSiteId: siteId };
    if (ivion360Context) return { fmGuid: ivion360Context.buildingFmGuid || '', ivionSiteId: ivion360Context.ivionSiteId || '' };
    return null;
  });
  
  const handleClose = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };
  
  if (!selectedBuilding) {
    return (
      <MobileBuildingSelector 
        onSelect={(fmGuid, ivionSiteId) => setSelectedBuilding({ fmGuid, ivionSiteId })} 
        onClose={handleClose} 
      />
    );
  }
  
  // Build Ivion URL
  const configured = appConfigs?.radar?.url?.trim();
  const baseUrl = configured ? configured.replace(/\/$/, '') : IVION_DEFAULT_BASE_URL;
  const ivionUrl = selectedBuilding.ivionSiteId 
    ? `${baseUrl}/?site=${selectedBuilding.ivionSiteId}`
    : ivion360Context?.ivionUrl || '';

  return (
    <div className="h-screen w-screen relative bg-background overflow-hidden fixed inset-0" style={{ touchAction: 'none' }}>
      {/* Back button overlay */}
      <div 
        className="absolute z-50 pointer-events-auto"
        style={{ 
          top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
          left: 'calc(env(safe-area-inset-left, 0px) + 0.5rem)'
        }}
      >
        <AppButton
          variant="secondary"
          size="icon"
          onClick={handleClose}
          className="h-10 w-10 bg-background/80 backdrop-blur-sm border border-border shadow-lg"
        >
          <ArrowLeft className="h-5 w-5" />
        </AppButton>
      </div>
      
      {/* 360 Viewer - fullscreen, no toolbar */}
      <div className="h-full w-full">
        <Ivion360View 
          url={ivionUrl}
          buildingFmGuid={selectedBuilding.fmGuid}
          ivionSiteIdProp={selectedBuilding.ivionSiteId}
        />
      </div>
    </div>
  );
};

export default Mobile360Viewer;
