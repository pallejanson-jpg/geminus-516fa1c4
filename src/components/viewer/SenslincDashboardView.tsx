import React, { useContext, useState } from 'react';
import { X, ExternalLink, Zap, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppContext } from '@/context/AppContext';
import { cn } from '@/lib/utils';

interface SenslincDashboardViewProps {
  onClose: () => void;
}

const SenslincDashboardView: React.FC<SenslincDashboardViewProps> = ({ onClose }) => {
  const { senslincDashboardContext } = useContext(AppContext);
  const [isLoading, setIsLoading] = useState(true);
  
  const dashboardUrl = senslincDashboardContext?.dashboardUrl || '';
  const facilityName = senslincDashboardContext?.facilityName || 'IoT Dashboard';

  const handleOpenExternal = () => {
    if (dashboardUrl) {
      window.open(dashboardUrl, '_blank');
    }
  };

  const handleRefresh = () => {
    setIsLoading(true);
    // Force iframe reload
    const iframe = document.getElementById('senslinc-iframe') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  if (!dashboardUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background p-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6">
          <Zap className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Ingen IoT-dashboard</h2>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          Det finns ingen sensor-dashboard konfigurerad för detta objekt. 
          Kontrollera att sensorDashboard-attributet är satt i Asset+, 
          eller att objektet är kopplat till Senslinc via FM GUID.
        </p>
        <Button onClick={onClose} variant="outline" className="gap-2">
          <X className="h-4 w-4" />
          Stäng
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header - themed with gradient */}
      <div className={cn(
        "flex items-center justify-between px-4 py-3 border-b",
        "bg-gradient-to-r from-card via-card to-primary/5"
      )}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">{facilityName}</h2>
            <p className="text-xs text-muted-foreground">Senslinc IoT Dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleRefresh} 
            title="Uppdatera"
            className="h-8 w-8 hover:bg-primary/10"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleOpenExternal} 
            title="Öppna i ny flik"
            className="h-8 w-8 hover:bg-primary/10"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose} 
            title="Stäng"
            className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Iframe with loading state */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <span className="text-sm text-muted-foreground">Laddar IoT-dashboard...</span>
          </div>
        )}
        <iframe
          id="senslinc-iframe"
          src={dashboardUrl}
          className="absolute inset-0 w-full h-full border-0"
          title="Senslinc Dashboard"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          loading="lazy"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
};

export default SenslincDashboardView;
