import React, { useState, useContext } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import CreateIssueDialog from './CreateIssueDialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface FmAccessIssueOverlayProps {
  buildingFmGuid: string;
  buildingName?: string;
  source: 'fma_plus' | '2d_fm_access';
  contextMetadata?: Record<string, any>;
}

const FmAccessIssueOverlay: React.FC<FmAccessIssueOverlayProps> = ({
  buildingFmGuid,
  buildingName,
  source,
  contextMetadata,
}) => {
  const [showDialog, setShowDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();
  const isMobile = useIsMobile();

  const handleSubmit = async (data: {
    title: string;
    description: string;
    issueType: string;
    priority: string;
  }) => {
    if (!user) {
      toast.error('You must be logged in to create issues');
      return;
    }

    setIsSubmitting(true);
    try {
      const viewpointJson = {
        source,
        ...contextMetadata,
      };

      const { error } = await supabase.from('bcf_issues').insert({
        title: data.title,
        description: data.description,
        issue_type: data.issueType,
        priority: data.priority,
        status: 'open',
        reported_by: user.id,
        building_fm_guid: buildingFmGuid,
        building_name: buildingName || null,
        viewpoint_json: viewpointJson,
      });

      if (error) throw error;

      toast.success('Issue created!');
      setShowDialog(false);
    } catch (err: any) {
      console.error('[FmAccessIssueOverlay] Error creating issue:', err);
      toast.error('Could not create issue: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* FAB button */}
      <button
        onClick={() => setShowDialog(true)}
        className={cn(
          "absolute z-30 flex items-center gap-2 rounded-full",
          "bg-card/80 backdrop-blur-md border border-border shadow-lg",
          "text-foreground hover:bg-card transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary/50",
          isMobile
            ? "bottom-4 right-4 h-12 px-4 text-sm"
            : "bottom-4 right-4 h-10 px-3.5 text-xs"
        )}
        style={isMobile ? { bottom: `calc(1rem + env(safe-area-inset-bottom, 0px))` } : undefined}
        title="Create issue"
      >
        <MessageSquarePlus className={cn(isMobile ? "h-5 w-5" : "h-4 w-4", "text-primary")} />
        <span className="font-medium">Create issue</span>
      </button>

      {/* Reuse existing CreateIssueDialog */}
      <CreateIssueDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSubmit={handleSubmit}
        buildingName={buildingName}
        isSubmitting={isSubmitting}
      />
    </>
  );
};

export default FmAccessIssueOverlay;
