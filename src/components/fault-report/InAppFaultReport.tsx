import React, { useState, useContext } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppContext } from '@/context/AppContext';
import FaultReportForm from './FaultReportForm';
import MobileFaultReport from './MobileFaultReport';
import FaultReportSuccess from './FaultReportSuccess';
import type { FaultReportFormData } from './FaultReportForm';

const InAppFaultReport: React.FC = () => {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const { faultReportPrefill, clearFaultReportPrefill, setActiveApp } = useContext(AppContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const handleSubmit = async (data: FaultReportFormData, photos: string[]) => {
    setIsSubmitting(true);
    try {
      const externalId = `FR-${Date.now()}`;
      const descSnippet = data.description.slice(0, 50);
      const autoTitle = faultReportPrefill?.buildingName
        ? `${t('Felanmälan', 'Fault report')}: ${faultReportPrefill.buildingName}`
        : `${t('Felanmälan', 'Fault report')}: ${descSnippet}`;

      const workOrder = {
        title: autoTitle,
        description: data.description,
        category: null,
        priority: 'medium' as const,
        status: 'open' as const,
        external_id: externalId,
        reported_by: null,
        reported_at: new Date().toISOString(),
        building_fm_guid: faultReportPrefill?.buildingFmGuid || null,
        building_name: faultReportPrefill?.buildingName || null,
        space_fm_guid: faultReportPrefill?.spaceFmGuid || null,
        space_name: faultReportPrefill?.spaceName || null,
        attributes: {
          error_code: data.errorCode || null,
          reporter_email: data.email || null,
          reporter_phone: data.phone || null,
          images: photos,
          source: 'in_app_fault_report',
        },
      };

      const { error } = await supabase.from('work_orders').insert(workOrder);
      if (error) throw error;

      setSubmittedId(externalId);
      toast.success(t('Felanmälan skickad!', 'Fault report submitted!'));
    } catch (err: any) {
      console.error('Submit error:', err);
      toast.error(
        t('Kunde inte skicka felanmälan', 'Could not submit fault report'),
        { description: t('Försök igen om en stund.', 'Please try again in a moment.') }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    clearFaultReportPrefill();
    setActiveApp('portfolio');
  };

  const handleReset = () => {
    setSubmittedId(null);
  };

  if (submittedId) {
    return (
      <FaultReportSuccess
        externalId={submittedId}
        buildingName={faultReportPrefill?.buildingName}
        onNewReport={handleReset}
        onClose={handleClose}
      />
    );
  }

  const buildingName = faultReportPrefill?.buildingName;
  const spaceName = faultReportPrefill?.spaceName;

  if (isMobile) {
    return (
      <MobileFaultReport
        buildingName={buildingName}
        spaceName={spaceName}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        onBack={handleClose}
      />
    );
  }

  return (
    <div className="h-full flex items-start justify-center pt-12 pb-12 px-4 overflow-auto">
      <FaultReportForm
        buildingName={buildingName}
        spaceName={spaceName}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default InAppFaultReport;
