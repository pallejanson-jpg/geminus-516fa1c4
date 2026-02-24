import React, { useEffect, useState } from "react";
import { MessageSquarePlus, Clock, AlertCircle, Lightbulb, HelpCircle, Eye, CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface BcfIssue {
  id: string;
  title: string;
  description: string | null;
  issue_type: string;
  priority: string;
  status: string;
  screenshot_url: string | null;
  created_at: string;
  viewpoint_json: any;
  selected_object_ids: string[] | null;
}

const ISSUE_TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  fault: { icon: AlertCircle, color: 'text-destructive' },
  improvement: { icon: Lightbulb, color: 'text-amber-500' },
  question: { icon: HelpCircle, color: 'text-blue-500' },
  observation: { icon: Eye, color: 'text-muted-foreground' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon?: React.ElementType }> = {
  open: { label: 'New', color: 'bg-destructive' },
  in_progress: { label: 'In Progress', color: 'bg-amber-500' },
  resolved: { label: 'Resolved', color: 'bg-emerald-500', icon: CheckCircle },
  closed: { label: 'Closed', color: 'bg-muted-foreground' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'border-slate-300',
  medium: 'border-amber-400',
  high: 'border-orange-500',
  critical: 'border-destructive',
};

interface IssueListPanelProps {
  buildingFmGuid?: string;
  onSelectIssue?: (issue: BcfIssue) => void;
  onCreateIssue?: () => void;
  className?: string;
}

const IssueListPanel: React.FC<IssueListPanelProps> = ({
  buildingFmGuid,
  onSelectIssue,
  onCreateIssue,
  className,
}) => {
  const [issues, setIssues] = useState<BcfIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchIssues = async () => {
      if (!buildingFmGuid) {
        setIssues([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('bcf_issues')
          .select('id, title, description, issue_type, priority, status, screenshot_url, created_at, viewpoint_json, selected_object_ids')
          .eq('building_fm_guid', buildingFmGuid)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setIssues(data || []);
      } catch (err) {
        console.error('Failed to fetch issues:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchIssues();

    const channel = supabase
      .channel('bcf_issues_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bcf_issues',
          filter: buildingFmGuid ? `building_fm_guid=eq.${buildingFmGuid}` : undefined,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setIssues((prev) => [payload.new as BcfIssue, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setIssues((prev) =>
              prev.map((issue) =>
                issue.id === (payload.new as BcfIssue).id ? (payload.new as BcfIssue) : issue
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setIssues((prev) => prev.filter((issue) => issue.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [buildingFmGuid]);

  const openIssues = issues.filter((i) => i.status === 'open' || i.status === 'in_progress');
  const resolvedIssues = issues.filter((i) => i.status === 'resolved' || i.status === 'closed');

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Issues</span>
          {issues.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {openIssues.length} open
            </Badge>
          )}
        </div>
        {onCreateIssue && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCreateIssue}>
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <MessageSquarePlus className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No issues yet</p>
            {onCreateIssue && (
              <Button variant="outline" size="sm" className="mt-3" onClick={onCreateIssue}>
                Create first issue
              </Button>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {openIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} onClick={() => onSelectIssue?.(issue)} />
            ))}

            {openIssues.length > 0 && resolvedIssues.length > 0 && (
              <div className="py-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wide px-2">
                  Resolved issues
                </div>
              </div>
            )}

            {resolvedIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onClick={() => onSelectIssue?.(issue)}
                compact
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

interface IssueCardProps {
  issue: BcfIssue;
  onClick?: () => void;
  compact?: boolean;
}

const IssueCard: React.FC<IssueCardProps> = ({ issue, onClick, compact }) => {
  const typeConfig = ISSUE_TYPE_CONFIG[issue.issue_type] || ISSUE_TYPE_CONFIG.observation;
  const statusConfig = STATUS_CONFIG[issue.status] || STATUS_CONFIG.open;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  const timeAgo = formatDistanceToNow(new Date(issue.created_at), {
    addSuffix: true,
  });

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border transition-all",
        "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50",
        PRIORITY_COLORS[issue.priority] || 'border-border',
        compact ? "p-2 border-l-2 opacity-70" : "p-3 border-l-4"
      )}
    >
      <div className="flex items-start gap-2">
        {StatusIcon ? (
          <StatusIcon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", "text-emerald-500")} />
        ) : (
          <TypeIcon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", typeConfig.color)} />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn("font-medium truncate", compact ? "text-xs" : "text-sm")}>
            {issue.title}
          </p>
          {!compact && (
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span
                className={cn("w-1.5 h-1.5 rounded-full", statusConfig.color)}
              />
              <span>{statusConfig.label}</span>
              <span>•</span>
              <Clock className="h-3 w-3" />
              <span>{timeAgo}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

export default IssueListPanel;
export type { BcfIssue };
