import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import FaultReportForm from '@/components/fault-report/FaultReportForm';
import MobileFaultReport from '@/components/fault-report/MobileFaultReport';
import FaultReportSuccess from '@/components/fault-report/FaultReportSuccess';
import type { FaultReportFormData } from '@/components/fault-report/FaultReportForm';
import type { PhotoData } from '@/components/fault-report/PhotoCapture';
import type { ErrorCode } from '@/components/fault-report/ErrorCodeCombobox';

interface ApiConfig {
  installationNumber?: string;
  assetName?: string;
  buildingName?: string;
  spaceName?: string;
  errorCodes: ErrorCode[];
  rawConfig: any;
}

const FaultReport: React.FC = () => {
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const qrKey = searchParams.get('key');

  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(!!qrKey);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!qrKey) return;
    setIsLoadingConfig(true);
    setConfigError(null);
    try {
      const { data, error } = await supabase.functions.invoke('errorreport-proxy', {
        body: { action: 'get-config', qrKey },
      });

      if (error) throw error;

      // Check if the edge function returned a 404-like error
      if (data?.error) {
        console.error('[FaultReport] API error:', data.error);
        setConfigError('Could not find the installation. Please verify the QR code is valid.');
        return;
      }

      console.log('[FaultReport] API config response:', data);

      const errorCodes: ErrorCode[] = [];
      if (data?.errorCodes && Array.isArray(data.errorCodes)) {
        for (const ec of data.errorCodes) {
          errorCodes.push({
            guid: ec.guid ?? 0,
            id: ec.id ?? '',
            title: ec.title ?? ec.id ?? '',
            description: ec.description ?? '',
            context: ec.context ?? null,
          });
        }
      }

      setApiConfig({
        installationNumber: data?.articleNumber || data?.installationNumber || data?.installation_number || undefined,
        assetName: data?.articleName || data?.assetName || data?.asset_name || data?.name || undefined,
        buildingName: data?.buildingName || data?.building_name || undefined,
        spaceName: data?.spaceName || data?.space_name || undefined,
        errorCodes,
        rawConfig: data,
      });
    } catch (err: any) {
      console.error('Config fetch error:', err);
      setConfigError('Could not connect to the server. Please try again.');
    } finally {
      setIsLoadingConfig(false);
    }
  }, [qrKey]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSubmit = async (data: FaultReportFormData, photos: string[], photoData: PhotoData[]) => {
    setIsSubmitting(true);
    try {
      if (qrKey) {
        const attachments = photoData.map((pd) => ({
          fileName: pd.fileName,
          mimeType: pd.mimeType,
          data: pd.data,
        }));

        const payload = {
          errorDescription: data.description,
          attachments,
          contactEmail: data.email || '',
          contactPhone: data.phone || '',
          errorCode: data.errorCode || null,
        };

        const { data: responseData, error } = await supabase.functions.invoke('errorreport-proxy', {
          body: { action: 'submit', qrKey, payload },
        });

        if (error) throw error;

        console.log('[FaultReport] Submit response:', responseData);

        const refId = responseData?.referenceNumber || responseData?.id || responseData?.externalId || `FR-${Date.now()}`;
        setSubmittedId(String(refId));
        toast.success('Felanmälan skickad!');
      } else {
        const externalId = `FR-${Date.now()}`;
        const workOrder = {
          title: `Felanmälan: ${data.description.slice(0, 50)}`,
          description: data.description,
          category: null,
          priority: 'medium' as const,
          status: 'open' as const,
          external_id: externalId,
          reported_by: null,
          reported_at: new Date().toISOString(),
          attributes: {
            error_code: data.errorCode || null,
            reporter_email: data.email || null,
            reporter_phone: data.phone || null,
            images: photos,
            source: 'fault_report',
          },
        };

        const { error } = await supabase.from('work_orders').insert(workOrder);
        if (error) throw error;

        setSubmittedId(externalId);
        toast.success('Felanmälan skickad!');
      }
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

  // Loading config
  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Hämtar konfiguration...</p>
        </div>
      </div>
    );
  }

  // Config error with retry
  if (configError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Något gick fel</h2>
          <p className="text-sm text-muted-foreground">{configError}</p>
          <Button onClick={fetchConfig} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Försök igen
          </Button>
        </div>
      </div>
    );
  }

  // Success state
  if (submittedId) {
    const installInfo = apiConfig?.installationNumber || apiConfig?.assetName
      ? `${apiConfig?.installationNumber || ''} ${apiConfig?.assetName || ''}`.trim()
      : undefined;

    return (
      <div className="min-h-screen bg-background">
        <FaultReportSuccess
          externalId={submittedId}
          buildingName={apiConfig?.buildingName}
          installationInfo={installInfo}
          onNewReport={handleReset}
        />
      </div>
    );
  }

  const installationNumber = apiConfig?.installationNumber;
  const assetName = apiConfig?.assetName;
  const buildingName = apiConfig?.buildingName;
  const spaceName = apiConfig?.spaceName;
  const errorCodes = apiConfig?.errorCodes;

  if (isMobile) {
    return (
      <MobileFaultReport
          buildingName={buildingName}
          spaceName={spaceName}
          installationNumber={installationNumber}
          assetName={assetName}
          errorCodes={errorCodes}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          onBack={() => window.history.back()}
        />

    );
  }

  return (
    <div className="min-h-screen bg-background flex items-start justify-center pt-12 pb-12 px-4">
      <FaultReportForm
        buildingName={buildingName}
        spaceName={spaceName}
        installationNumber={installationNumber}
        assetName={assetName}
        errorCodes={errorCodes}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default FaultReport;
