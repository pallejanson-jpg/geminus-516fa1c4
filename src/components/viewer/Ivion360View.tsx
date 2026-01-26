import React, { useState, useEffect } from "react";
import { Loader2, ExternalLink, X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Ivion360ViewProps {
  onClose?: () => void;
}

export default function Ivion360View({ onClose }: Ivion360ViewProps) {
  const [ivionUrl, setIvionUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    // Get the stored Ivion URL
    const storedUrl = localStorage.getItem('ivion360Url');
    setIvionUrl(storedUrl);
  }, []);

  const handleOpenExternal = () => {
    if (ivionUrl) {
      window.open(ivionUrl, '_blank');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (!ivionUrl) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No 360° view configured</p>
          <p className="text-xs mt-2">Configure Ivion Site ID in building settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">360° Viewer</span>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenExternal}
            title="Open in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Iframe container */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading 360° view...</span>
            </div>
          </div>
        )}
        <iframe
          src={ivionUrl}
          className="w-full h-full border-0"
          onLoad={() => setIsLoading(false)}
          allow="fullscreen; autoplay"
          title="Ivion 360 Viewer"
        />
      </div>
    </div>
  );
}
