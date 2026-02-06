import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import FaultReportForm from '@/components/fault-report/FaultReportForm';
import MobileFaultReport from '@/components/fault-report/MobileFaultReport';
import FaultReportSuccess from '@/components/fault-report/FaultReportSuccess';
import type { FaultReportFormData } from '@/components/fault-report/FaultReportForm';

interface QrConfig {
  building_fm_guid: string;
  building_name: string | null;
  space_fm_guid: string | null;
  space_name: string | null;
}

const FaultReport: React.FC = () => {
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const qrKey = searchParams.get('key');

  const [qrConfig, setQrConfig] = useState<QrConfig | null>(null);
  const [isLoadingQr, setIsLoadingQr] = useState(!!qrKey);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  // Look up QR config if key is present
  useEffect(() => {
    if (!qrKey) return;

    const lookupQr = async () => {
      setIsLoadingQr(true);
      setQrError(null);
      try {
        const { data, error } = await supabase
          .from('qr_report_configs')
          .select('building_fm_guid, building_name, space_fm_guid, space_name')
          .eq('qr_key', qrKey)
          .eq('is_active', true)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setQrError('Ogiltig eller inaktiv QR-kod');
          return;
        }
        setQrConfig(data);
      } catch (err: any) {
        console.error('QR lookup error:', err);
        setQrError('Kunde inte läsa QR-koden. Försök igen.');
      } finally {
        setIsLoadingQr(false);
      }
    };

    lookupQr();
  }, [qrKey]);

  const handleSubmit = async (data: FaultReportFormData, photos: string[]) => {
    setIsSubmitting(true);
    try {
      const externalId = `FR-${Date.now()}`;

      const workOrder = {
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        status: 'open' as const,
        external_id: externalId,
        reported_by: data.reporterName,
        reported_at: new Date().toISOString(),
        building_fm_guid: qrConfig?.building_fm_guid || null,
        building_name: qrConfig?.building_name || null,
        space_fm_guid: qrConfig?.space_fm_guid || null,
        space_name: qrConfig?.space_name || null,
        attributes: {
          reporter_email: data.reporterEmail,
          reporter_phone: data.reporterPhone || null,
          images: photos,
          source: 'fault_report',
          qr_key: qrKey || null,
        },
      };

      const { error } = await supabase.from('work_orders').insert(workOrder);

      if (error) throw error;

      setSubmittedId(externalId);
      toast.success('Felanmälan skickad!');
    } catch (err: any) {
      console.error('Submit error:', err);
      toast.error('Kunde inte skicka felanmälan', {
        description: err.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmittedId(null);
  };

  // Loading QR config
  if (isLoadingQr) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Läser QR-kod...</p>
        </div>
      </div>
    );
  }

  // QR error
  if (qrError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Något gick fel</h2>
          <p className="text-sm text-muted-foreground">{qrError}</p>
        </div>
      </div>
    );
  }

  // Success state
  if (submittedId) {
    return (
      <div className="min-h-screen bg-background">
        <FaultReportSuccess
          externalId={submittedId}
          buildingName={qrConfig?.building_name || undefined}
          onNewReport={handleReset}
        />
      </div>
    );
  }

  const buildingName = qrConfig?.building_name || undefined;
  const spaceName = qrConfig?.space_name || undefined;

  // Mobile wizard layout
  if (isMobile) {
    return (
      <div className="h-screen bg-background">
        <MobileFaultReport
          buildingName={buildingName}
          spaceName={spaceName}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          onBack={() => window.history.back()}
        />
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-screen bg-background flex items-start justify-center pt-12 pb-12 px-4">
      <FaultReportForm
        buildingName={buildingName}
        spaceName={spaceName}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default FaultReport;
