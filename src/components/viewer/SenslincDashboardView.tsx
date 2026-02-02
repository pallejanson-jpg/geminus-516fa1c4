import React, { useContext } from 'react';
import { X, ExternalLink, Zap, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppContext } from '@/context/AppContext';

interface SenslincDashboardViewProps {
  onClose: () => void;
}

const SenslincDashboardView: React.FC<SenslincDashboardViewProps> = ({ onClose }) => {
  const { senslincDashboardContext } = useContext(AppContext);
  
  const dashboardUrl = senslincDashboardContext?.dashboardUrl || '';
  const facilityName = senslincDashboardContext?.facilityName || 'IoT Dashboard';

  const handleOpenExternal = () => {
    if (dashboardUrl) {
      window.open(dashboardUrl, '_blank');
    }
  };

  const handleRefresh = () => {
    // Force iframe reload
    const iframe = document.getElementById('senslinc-iframe') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
  };

  if (!dashboardUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background p-8">
        <Zap className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Ingen IoT-dashboard</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Det finns ingen sensor-dashboard konfigurerad för detta objekt. 
          Kontrollera att sensorDashboard-attributet är satt i Asset+.
        </p>
        <Button onClick={onClose} variant="outline" className="mt-6">
          Stäng
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold text-sm">{facilityName}</h2>
            <p className="text-xs text-muted-foreground">Senslinc IoT Dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleRefresh} title="Uppdatera">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleOpenExternal} title="Öppna i ny flik">
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="Stäng">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative">
        <iframe
          id="senslinc-iframe"
          src={dashboardUrl}
          className="absolute inset-0 w-full h-full border-0"
          title="Senslinc Dashboard"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          loading="lazy"
        />
      </div>
    </div>
  );
};

export default SenslincDashboardView;
