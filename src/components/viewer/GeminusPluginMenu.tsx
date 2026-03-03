import React, { useState, useContext, useCallback } from 'react';
import {
  Menu, X, MessageSquarePlus, LifeBuoy, BarChart2, Bot, FileText, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppContext } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

import CreateIssueDialog from './CreateIssueDialog';
import CreateWorkOrderDialog from './CreateWorkOrderDialog';
import InsightsDrawerPanel from './InsightsDrawerPanel';
import GunnarChat from '@/components/chat/GunnarChat';
import CreateSupportCase from '@/components/support/CreateSupportCase';

interface GeminusPluginMenuProps {
  buildingFmGuid?: string;
  buildingName?: string;
  source: string;
  contextMetadata?: Record<string, any>;
}

type ActivePanel = null | 'issue' | 'workorder' | 'support' | 'insights' | 'gunnar' | 'ilean';

const MENU_ITEMS = [
  { id: 'issue' as const, label: 'Skapa ärende', icon: MessageSquarePlus },
  { id: 'workorder' as const, label: 'Arbetsorder', icon: Wrench },
  { id: 'support' as const, label: 'Supportärende', icon: LifeBuoy },
  { id: 'insights' as const, label: 'Insikter', icon: BarChart2 },
  { id: 'gunnar' as const, label: 'Fråga Gunnar', icon: Bot },
  { id: 'ilean' as const, label: 'Fråga Ilean', icon: FileText },
];

export default function GeminusPluginMenu({
  buildingFmGuid,
  buildingName,
  source,
  contextMetadata,
}: GeminusPluginMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();

  const handleOpen = useCallback((panel: ActivePanel) => {
    setActivePanel(panel);
    setExpanded(false);
  }, []);

  const handleClose = useCallback(() => {
    setActivePanel(null);
  }, []);

  // ── Issue submit handler ──
  const handleIssueSubmit = useCallback(async (data: {
    title: string;
    description: string;
    issueType: string;
    priority: string;
  }) => {
    if (!user) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('bcf_issues').insert({
        title: data.title,
        description: data.description,
        issue_type: data.issueType,
        priority: data.priority,
        reported_by: user.id,
        building_fm_guid: buildingFmGuid || null,
        building_name: buildingName || null,
        viewpoint_json: { source, ...contextMetadata },
      });
      if (error) throw error;
      toast.success('Ärende skapat');
      handleClose();
    } catch (err: any) {
      toast.error('Kunde inte skapa ärende: ' + (err.message || 'Okänt fel'));
    } finally {
      setIsSubmitting(false);
    }
  }, [user, buildingFmGuid, buildingName, source, contextMetadata, handleClose]);

  return (
    <>
      {/* ── FAB + expandable menu ── */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {/* Action items — shown when expanded */}
        {expanded && (
          <div className="flex flex-col gap-1.5 mb-1 animate-in slide-in-from-bottom-2 fade-in duration-200">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => handleOpen(item.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg',
                  'bg-card/90 backdrop-blur-md border border-border shadow-lg',
                  'text-sm text-foreground hover:bg-accent transition-colors',
                  'whitespace-nowrap'
                )}
              >
                <item.icon className="h-4 w-4 text-primary" />
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* Main FAB */}
        <Button
          size="icon"
          className={cn(
            'h-12 w-12 rounded-full shadow-xl',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'transition-transform',
            expanded && 'rotate-45'
          )}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* ── Backdrop when expanded ── */}
      {expanded && (
        <div
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setExpanded(false)}
        />
      )}

      {/* ── Panels / dialogs ── */}

      {/* Create Issue */}
      <CreateIssueDialog
        open={activePanel === 'issue'}
        onClose={handleClose}
        onSubmit={handleIssueSubmit}
        buildingName={buildingName}
        isSubmitting={isSubmitting}
      />

      {/* Work Order */}
      <CreateWorkOrderDialog
        open={activePanel === 'workorder'}
        onClose={handleClose}
        buildingName={buildingName}
        buildingFmGuid={buildingFmGuid}
      />

      {/* Support Case */}
      {activePanel === 'support' && (
        <CreateSupportCase
          open={true}
          onClose={handleClose}
          onCreated={() => {
            toast.success('Supportärende skapat');
            handleClose();
          }}
          prefill={{
            building_name: buildingName,
            building_fm_guid: buildingFmGuid,
          }}
        />
      )}

      {/* Insights */}
      {buildingFmGuid && (
        <InsightsDrawerPanel
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingName}
          open={activePanel === 'insights'}
          onClose={handleClose}
        />
      )}

      {/* Gunnar Chat */}
      {activePanel === 'gunnar' && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[70vh] bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
            <span className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Gunnar
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden" style={{ minHeight: 300 }}>
            <GunnarChat open={true} onClose={handleClose} embedded />
          </div>
        </div>
      )}

      {/* Ilean — simple doc Q&A placeholder using Gunnar for now */}
      {activePanel === 'ilean' && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[70vh] bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
            <span className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Ilean — Dokument
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden p-4 text-center text-sm text-muted-foreground" style={{ minHeight: 300 }}>
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p>Ilean dokument-AI</p>
            <p className="text-xs mt-1">Ställ frågor om dokument för {buildingName || 'denna byggnad'}.</p>
            {/* The full IleanButton component is standalone with its own context; 
                here we render a simplified entry point */}
          </div>
        </div>
      )}
    </>
  );
}
