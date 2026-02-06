import React, { useState, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppContext } from '@/context/AppContext';
import FaultReportForm from './FaultReportForm';
import MobileFaultReport from './MobileFaultReport';
import FaultReportSuccess from './FaultReportSuccess';
import type { FaultReportFormData } from './FaultReportForm';

const InAppFaultReport: React.FC = () => {
  const isMobile = useIsMobile();
  const { faultReportPrefill, clearFaultReportPrefill, setActiveApp } = useContext(AppContext);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

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
        building_fm_guid: faultReportPrefill?.buildingFmGuid || null,
        building_name: faultReportPrefill?.buildingName || null,
        space_fm_guid: faultReportPrefill?.spaceFmGuid || null,
        space_name: faultReportPrefill?.spaceName || null,
        attributes: {
          reporter_email: data.reporterEmail,
          reporter_phone: data.reporterPhone || null,
          images: photos,
          source: 'in_app_fault_report',
        },
      };

      const { error } = await supabase.from('work_orders').insert(workOrder);
      if (error) throw error;

      setSubmittedId(externalId);
      toast.success('Felanmälan skickad!');
    } catch (err: any) {
      console.error('Submit error:', err);
      toast.error('Kunde inte skicka felanmälan', { description: err.message });
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
