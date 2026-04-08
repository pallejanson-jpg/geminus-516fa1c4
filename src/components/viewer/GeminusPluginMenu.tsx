import React, { useState, useContext, useCallback, useEffect, useRef } from 'react';
import {
  Menu, X, MessageSquarePlus, LifeBuoy, BarChart2, Bot, FileText, Wrench,
  Send, Loader2, Package, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppContext } from '@/context/AppContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FmAccessContextChangedDetail } from '@/lib/event-bus';

import CreateIssueDialog from './CreateIssueDialog';
import CreateWorkOrderDialog from './CreateWorkOrderDialog';
import InsightsDrawerPanel from './InsightsDrawerPanel';
import GunnarChat, { GunnarContext } from '@/components/chat/GunnarChat';
import CreateSupportCase from '@/components/support/CreateSupportCase';
import IleanEmbeddedChat from './IleanEmbeddedChat';
import InventoryPanel from './InventoryPanel';

import { on } from '@/lib/event-bus';
interface GeminusPluginMenuProps {
  buildingFmGuid?: string;
  buildingName?: string;
  source: string;
  contextMetadata?: Record<string, any>;
}

type ActivePanel = null | 'issue' | 'workorder' | 'support' | 'insights' | 'gunnar' | 'ilean' | 'inventory' | 'viewer';

const MENU_ITEMS = [
  { id: 'issue' as const, label: 'Skapa ärende', icon: MessageSquarePlus },
  { id: 'workorder' as const, label: 'Arbetsorder', icon: Wrench },
  { id: 'support' as const, label: 'Supportärende', icon: LifeBuoy },
  { id: 'inventory' as const, label: 'Asset panel', icon: Package },
  { id: 'insights' as const, label: 'Insikter', icon: BarChart2 },
  { id: 'viewer' as const, label: 'Geminus View', icon: Eye },
  { id: 'gunnar' as const, label: 'Fråga Geminus AI', icon: Bot },
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
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipShownRef = useRef(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();

  // Track live FM Access context changes (object selection in iframe)
  const [fmaLiveContext, setFmaLiveContext] = useState<Record<string, any>>({});

  useEffect(() => {
    const isFma = source === 'fma_plus' || source === '2d_fm_access';
    if (!isFma) return;
    const handler = (detail: FmAccessContextChangedDetail) => {
      if (detail) setFmaLiveContext(detail);
    };
    const off = on('FM_ACCESS_CONTEXT_CHANGED', handler);
    return () => off();
  }, [source]);

  // Auto-show tooltip on first render to help discoverability
  useEffect(() => {
    if (tooltipShownRef.current) return;
    tooltipShownRef.current = true;
    const timer = setTimeout(() => setShowTooltip(true), 800);
    const hideTimer = setTimeout(() => setShowTooltip(false), 4000);
    return () => { clearTimeout(timer); clearTimeout(hideTimer); };
  }, []);

  const handleOpen = useCallback((panel: ActivePanel) => {
    if (panel === 'viewer') {
      // Navigate to Geminus View — open in new tab if in plugin/iframe context
      const isPlugin = source === 'fma_plus' || source === '2d_fm_access' || source === 'faciliate';
      const url = '/view';
      if (isPlugin || window !== window.top) {
        window.open(url, '_blank');
      } else {
        window.location.href = url;
      }
      setExpanded(false);
      return;
    }
    setActivePanel(panel);
    setExpanded(false);
  }, [source]);

  const handleClose = useCallback(() => {
    setActivePanel(null);
  }, []);

  // Build Gunnar context from plugin menu props + live FM Access context
  const gunnarContext: GunnarContext & { contextMetadata?: Record<string, any> } = {
    activeApp: source === 'fma_plus' ? 'fma_plus' : source === 'fma_native' ? 'fma_native' : source === '2d_fm_access' ? 'fma_plus' : source,
    currentBuilding: buildingFmGuid ? { fmGuid: buildingFmGuid, name: buildingName || 'Building' } : undefined,
    currentStorey: contextMetadata?.floorGuid ? { fmGuid: contextMetadata.floorGuid, name: contextMetadata.floorName || '' } : undefined,
    currentSpace: contextMetadata?.roomGuid ? { fmGuid: contextMetadata.roomGuid, name: contextMetadata.roomName || '' } : undefined,
    contextMetadata: { standalone: !!contextMetadata?.standalone },
  };

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
      toast.error('Could not create issue: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  }, [user, buildingFmGuid, buildingName, source, contextMetadata, handleClose]);

  return (
    <>
      {/* ── FAB + expandable menu ── */}
      <div
        className="fixed right-4 z-40 flex flex-col items-end gap-2"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
      >
        {/* Action items — shown when expanded */}
        {expanded && (
          <div className={cn(
            "flex flex-col gap-1.5 mb-1 animate-in slide-in-from-bottom-2 fade-in duration-200",
            isMobile && "max-h-[60dvh] overflow-y-auto"
          )}>
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => handleOpen(item.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 rounded-lg min-h-[44px]',
                  'bg-card/90 backdrop-blur-md border border-border shadow-lg',
                  'text-sm text-foreground hover:bg-accent transition-colors',
                  'whitespace-nowrap'
                )}
              >
                <item.icon className="h-4 w-4 text-primary shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* Main FAB with tooltip */}
        <TooltipProvider delayDuration={0}>
          <Tooltip open={showTooltip && !expanded}>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                className={cn(
                  'h-12 w-12 rounded-full shadow-xl',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'transition-transform',
                  expanded && 'rotate-45',
                  !expanded && 'animate-pulse'
                )}
                onClick={() => {
                  setExpanded((v) => !v);
                  setShowTooltip(false);
                }}
              >
                {expanded ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-primary text-primary-foreground border-primary">
              Geminus-menyn
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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

      {/* Insights — fixed floating panel */}
      {activePanel === 'insights' && buildingFmGuid && (
        <div className={cn(
          "fixed z-50 bg-card/95 backdrop-blur-md border border-border shadow-2xl flex flex-col overflow-hidden animate-in fade-in duration-200",
          isMobile
            ? "inset-x-0 top-0 slide-in-from-bottom-4"
            : "bottom-24 right-6 w-[480px] max-h-[70vh] rounded-xl slide-in-from-bottom-4"
        )}
        style={isMobile ? { bottom: 0, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : undefined}
        >
          <InsightsDrawerPanel
            buildingFmGuid={buildingFmGuid}
            buildingName={buildingName}
            open={true}
            onClose={handleClose}
          />
        </div>
      )}

      {/* Gunnar Chat — fullscreen on mobile, floating panel on desktop */}
      {activePanel === 'gunnar' && (
        <div className={cn(
          "fixed z-50 bg-card/95 backdrop-blur-md border border-border shadow-2xl flex flex-col overflow-hidden animate-in fade-in duration-200",
          isMobile
            ? "inset-x-0 top-0 slide-in-from-bottom-4"
            : "bottom-24 right-6 w-[380px] max-h-[70vh] rounded-xl slide-in-from-bottom-4"
        )}
        style={isMobile ? { bottom: 0, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : undefined}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
            <span className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Geminus AI
            </span>
            <Button variant="ghost" size="icon" className="h-9 w-9 min-h-[44px] min-w-[44px]" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <GunnarChat open={true} onClose={handleClose} context={gunnarContext} embedded />
          </div>
        </div>
      )}

      {/* Ilean — fullscreen on mobile, floating panel on desktop */}
      {activePanel === 'ilean' && (
        <div className={cn(
          "fixed z-50 bg-card/95 backdrop-blur-md border border-border shadow-2xl flex flex-col overflow-hidden animate-in fade-in duration-200",
          isMobile
            ? "inset-x-0 top-0 slide-in-from-bottom-4"
            : "bottom-24 right-6 w-[380px] max-h-[70vh] rounded-xl slide-in-from-bottom-4"
        )}
        style={isMobile ? { bottom: 0, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : undefined}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
            <span className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Ilean — Dokument
            </span>
            <Button variant="ghost" size="icon" className="h-9 w-9 min-h-[44px] min-w-[44px]" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <IleanEmbeddedChat
              buildingFmGuid={buildingFmGuid}
              buildingName={buildingName}
            />
          </div>
        </div>
      )}

      {/* Inventory */}
      {buildingFmGuid && (
        <InventoryPanel
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingName}
          open={activePanel === 'inventory'}
          onClose={handleClose}
        />
      )}
    </>
  );
}
