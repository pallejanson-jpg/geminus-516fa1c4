import React, { useState, useRef, useContext } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FmAccessIssueOverlay from './FmAccessIssueOverlay';
import { AppContext } from '@/context/AppContext';
import { useIsMobile } from '@/hooks/use-mobile';

interface FmaInternalViewProps {
  url: string;
  buildingFmGuid?: string;
  buildingName?: string;
}

const FmaInternalView: React.FC<FmaInternalViewProps> = ({
  url,
  buildingFmGuid,
  buildingName,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { setActiveApp } = useContext(AppContext);
  const isMobile = useIsMobile();

  return (
    <div className="relative w-full h-full bg-background">
      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Laddar FMA+...</p>
          </div>
        </div>
      )}

      {/* Mobile back button */}
      {isMobile && (
        <Button
          variant="outline"
          size="icon"
          className="absolute top-3 left-3 z-30 h-9 w-9 bg-card/80 backdrop-blur-md border-border shadow-lg"
          onClick={() => setActiveApp('home')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}

      {/* FM Access iframe */}
      {url && (
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0"
          style={{ opacity: isLoading ? 0 : 1 }}
          title="FMA+"
          allow="fullscreen"
          onLoad={() => setIsLoading(false)}
        />
      )}

      {/* Issue overlay FAB */}
      {!isLoading && buildingFmGuid && (
        <FmAccessIssueOverlay
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingName}
          source="fma_plus"
          contextMetadata={{ url }}
        />
      )}
    </div>
  );
};

export default FmaInternalView;
