import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import SupportCaseList from './SupportCaseList';
import CreateSupportCase from './CreateSupportCase';
import FeedbackView from './FeedbackView';

const CustomerPortalView: React.FC = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreated = () => {
    setShowCreate(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <PageHeader
        title="Support"
        description="Cases, feedback and contact with SWG"
        actions={
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New case
          </Button>
        }
      />

      <Tabs defaultValue="cases">
        <TabsList>
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
        </TabsList>

        <TabsContent value="cases">
          <SupportCaseList key={refreshKey} />
        </TabsContent>

        <TabsContent value="feedback">
          <FeedbackView />
        </TabsContent>

        <TabsContent value="contact">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Contact SWG</h3>
            <div className="grid gap-3 text-sm text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Email:</span>{' '}
                <a href="mailto:support@swg.se" className="text-primary hover:underline">support@swg.se</a>
              </div>
              <div>
                <span className="font-medium text-foreground">Phone:</span>{' '}
                <a href="tel:+4686909600" className="text-primary hover:underline">08-690 96 00</a>
              </div>
              <div>
                <span className="font-medium text-foreground">Office hours:</span>{' '}
                Weekdays 08:00–17:00
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              You can also create a case directly via the "New case" button above, 
              or submit a case from the 3D viewer via "Send to Support".
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {showCreate && (
        <CreateSupportCase
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
};

export default CustomerPortalView;
