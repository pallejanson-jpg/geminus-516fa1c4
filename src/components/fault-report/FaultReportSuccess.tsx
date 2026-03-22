import React from 'react';
import { CheckCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface FaultReportSuccessProps {
  externalId: string;
  buildingName?: string;
  installationInfo?: string;
  onNewReport?: () => void;
  onClose?: () => void;
}

const FaultReportSuccess: React.FC<FaultReportSuccessProps> = ({
  externalId,
  buildingName,
  installationInfo,
  onNewReport,
  onClose,
}) => {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="max-w-md w-full text-center">
        <CardContent className="pt-8 pb-6 space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-primary" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold">Fault report submitted!</h2>
            <p className="text-sm text-muted-foreground">
              Your fault report has been registered
              {installationInfo ? ` for ${installationInfo}` : buildingName ? ` for ${buildingName}` : ''}.
            </p>
          </div>

          <div className="bg-muted/50 rounded-md p-3">
            <p className="text-xs text-muted-foreground">Reference number</p>
            <p className="font-mono font-semibold text-sm">{externalId}</p>
          </div>

          <p className="text-xs text-muted-foreground">
            Save the reference number if you need to follow up on the case.
          </p>

          <div className="flex gap-2 pt-2">
            {onNewReport && (
              <Button variant="outline" onClick={onNewReport} className="flex-1">
                New report
              </Button>
            )}
            {onClose && (
              <Button onClick={onClose} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FaultReportSuccess;
