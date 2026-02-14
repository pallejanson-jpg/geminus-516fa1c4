import React, { useState, useRef, useContext, useEffect } from 'react';
import { Loader2, ArrowLeft, ExternalLink, AlertTriangle } from 'lucide-react';
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
  const [loadError, setLoadError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { setActiveApp } = useContext(AppContext);
  const isMobile = useIsMobile();

  // Timeout: if iframe hasn't loaded within 15s, show fallback
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => {
      if (isLoading) {
        setLoadError(true);
        setIsLoading(false);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const handleOpenExternal = () => {
    window.open(url, '_blank');
  };

  return (
    <div className="relative w-full h-full bg-background" style={{ minHeight: '100%' }}>
      {/* Loading indicator */}
      {isLoading && !loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Laddar FMA+...</p>
          </div>
        </div>
      )}

      {/* Error / timeout fallback */}
      {loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="text-center space-y-4 p-6 max-w-sm">
            <AlertTriangle className="h-10 w-10 text-yellow-500 mx-auto" />
            <h3 className="text-lg font-semibold text-foreground">FMA+ kunde inte laddas</h3>
            <p className="text-sm text-muted-foreground">
              Servern svarar inte eller blockerar inbäddning. Prova att öppna i en ny flik istället.
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleOpenExternal} className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Öppna FMA+ i ny flik
              </Button>
              <Button variant="outline" onClick={() => setActiveApp('home')}>
                Tillbaka
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile back button */}
      {isMobile && !loadError && (
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
      {url && !loadError && (
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full border-0"
          style={{ 
            opacity: isLoading ? 0 : 1,
            height: '100%',
            minHeight: '100vh',
          }}
          title="FMA+"
          allow="fullscreen"
          onLoad={() => {
            setIsLoading(false);
            setLoadError(false);
          }}
          onError={() => {
            setLoadError(true);
            setIsLoading(false);
          }}
        />
      )}

      {/* Issue overlay FAB */}
      {!isLoading && !loadError && buildingFmGuid && (
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
