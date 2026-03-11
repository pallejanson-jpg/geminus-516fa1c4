import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  Lightbulb,
  HelpCircle,
  Eye,
  Clock,
  MapPin,
  Send,
  CheckCircle,
  Loader2,
  User,
  Box,
  Mail,
  LifeBuoy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import type { BcfIssue } from "./IssueListPanel";
import SendIssueDialog from "./SendIssueDialog";

interface BcfComment {
  id: string;
  user_id: string;
  comment: string;
  created_at: string;
  profile?: {
    display_name: string | null;
    avatar_url: string | null;
  };
}

const ISSUE_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  fault: { label: 'Fault', icon: AlertCircle, color: 'text-destructive' },
  improvement: { label: 'Improvement', icon: Lightbulb, color: 'text-amber-500' },
  question: { label: 'Question', icon: HelpCircle, color: 'text-blue-500' },
  observation: { label: 'Observation', icon: Eye, color: 'text-muted-foreground' },
};

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

interface Assignment {
  id: string;
  assigned_to_user_id: string;
  sent_at: string | null;
  viewed_at: string | null;
  response_status: string | null;
  profile?: { display_name: string | null; avatar_url: string | null };
}

const SentAssignments: React.FC<{ issueId: string }> = ({ issueId }) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useEffect(() => {
    supabase
      .from("bcf_issue_assignments")
      .select("id, assigned_to_user_id, sent_at, viewed_at, response_status")
      .eq("issue_id", issueId)
      .then(async ({ data }) => {
        if (!data || data.length === 0) { setAssignments([]); return; }
        const userIds = [...new Set(data.map(a => a.assigned_to_user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name, avatar_url")
          .in("user_id", userIds);
        const pMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
        setAssignments(data.map(a => ({ ...a, profile: pMap.get(a.assigned_to_user_id) })));
      });
  }, [issueId]);

  if (assignments.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
        <Mail className="h-4 w-4" />
        Sent to
      </h4>
      <div className="space-y-1">
        {assignments.map(a => (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              {a.profile?.avatar_url ? (
                <img src={a.profile.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                <User className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
            <span>{a.profile?.display_name || "User"}</span>
            <span className="text-xs text-muted-foreground ml-auto">
              {a.viewed_at ? (
                <span className="flex items-center gap-1 text-primary"><CheckCircle className="h-3 w-3" /> Viewed</span>
              ) : a.sent_at ? (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Sent {formatDistanceToNow(new Date(a.sent_at), { addSuffix: true })}</span>
              ) : "Pending"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface IssueDetailSheetProps {
  issue: BcfIssue | null;
  open: boolean;
  onClose: () => void;
  onGoToViewpoint?: (viewpoint: any, selectedObjectIds?: string[] | null) => void;
  isAdmin?: boolean;
}

const IssueDetailSheet: React.FC<IssueDetailSheetProps> = ({
  issue,
  open,
  onClose,
  onGoToViewpoint,
  isAdmin = false,
}) => {
  const { user } = useAuth();
  const [comments, setComments] = useState<BcfComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(issue?.status || 'open');
  const [showSendDialog, setShowSendDialog] = useState(false);

  useEffect(() => {
    if (issue) {
      setCurrentStatus(issue.status);
      fetchComments(issue.id);
    }
  }, [issue?.id]);

  const fetchComments = async (issueId: string) => {
    setIsLoadingComments(true);
    try {
      const { data, error } = await supabase
        .from('bcf_comments')
        .select('id, user_id, comment, created_at')
        .eq('issue_id', issueId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const userIds = [...new Set((data || []).map(c => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      setComments((data || []).map(c => ({
        ...c,
        profile: profileMap.get(c.user_id),
      })));
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setIsLoadingComments(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !issue || !user) return;

    setIsSubmittingComment(true);
    try {
      const { error } = await supabase.from('bcf_comments').insert({
        issue_id: issue.id,
        user_id: user.id,
        comment: newComment.trim(),
      });

      if (error) throw error;

      setNewComment("");
      await fetchComments(issue.id);
      toast({ title: "Comment sent" });
    } catch (err) {
      console.error('Failed to submit comment:', err);
      toast({ title: "Failed to send comment", variant: "destructive" });
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!issue || !isAdmin) return;

    setIsUpdatingStatus(true);
    try {
      const updateData: any = { status: newStatus };
      
      if (newStatus === 'resolved') {
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = user?.id;
      }

      const { error } = await supabase
        .from('bcf_issues')
        .update(updateData)
        .eq('id', issue.id);

      if (error) throw error;

      setCurrentStatus(newStatus);
      toast({ title: "Status updated" });
      // Auto-close the detail sheet when issue is closed
      if (newStatus === 'closed') {
        setTimeout(() => onClose(), 500);
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      toast({ title: "Failed to update status", variant: "destructive" });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  if (!issue) return null;

  const typeConfig = ISSUE_TYPE_CONFIG[issue.issue_type] || ISSUE_TYPE_CONFIG.observation;
  const TypeIcon = typeConfig.icon;

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
        <SheetContent className="sm:max-w-lg w-full flex flex-col [&>div[data-radix-dialog-overlay]]:hidden">
          <SheetHeader className="flex-shrink-0">
            <div className="flex items-start gap-3">
              <div className={cn("p-2 rounded-lg bg-muted", typeConfig.color)}>
                <TypeIcon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-left">{issue.title}</SheetTitle>
                <SheetDescription className="text-left flex items-center gap-2 mt-1">
                  <Badge variant="outline">{typeConfig.label}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(issue.created_at), 'PPP')}
                  </span>
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 py-4">
              {/* Screenshot */}
              {issue.screenshot_url && (
                <div 
                  className="rounded-lg overflow-hidden border cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => issue.viewpoint_json && onGoToViewpoint?.(issue.viewpoint_json, issue.selected_object_ids)}
                >
                  <img
                    src={issue.screenshot_url}
                    alt="Screenshot"
                    className="w-full h-40 object-cover"
                  />
                  {issue.viewpoint_json && (
                    <div className="bg-muted/80 p-2 text-xs text-center flex items-center justify-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Click to go to position
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              {issue.description && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Description</h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {issue.description}
                  </p>
                </div>
              )}

              {/* Related objects */}
              {issue.selected_object_ids && issue.selected_object_ids.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
                    <Box className="h-4 w-4" />
                    Related objects
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {issue.selected_object_ids.map((id) => (
                      <Badge key={id} variant="outline" className="text-xs font-mono">
                        {id.length > 12 ? `${id.substring(0, 12)}...` : id}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Sent assignments */}
              <SentAssignments issueId={issue.id} />

              {/* Admin actions */}
              {isAdmin && (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Status</h4>
                    <Select
                      value={currentStatus}
                      onValueChange={handleStatusChange}
                      disabled={isUpdatingStatus}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowSendDialog(true)}
                  >
                    <Mail className="h-4 w-4 mr-1" />
                    Send to user
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      if (!user) return;
                      try {
                        const { error } = await supabase.from('support_cases').insert({
                          title: issue.title,
                          description: issue.description || null,
                          reported_by: user.id,
                          bcf_issue_id: issue.id,
                          screenshot_url: issue.screenshot_url || null,
                          building_fm_guid: issue.building_fm_guid || null,
                          building_name: issue.building_name || null,
                          priority: issue.priority || 'medium',
                          category: issue.issue_type === 'fault' ? 'fault' : 'question',
                        });
                        if (error) throw error;
                         toast({ title: "Sent to Support" });
                       } catch {
                         toast({ title: "Could not send to Support", variant: "destructive" });
                       }
                    }}
                  >
                    <LifeBuoy className="h-4 w-4 mr-1" />
                    Skicka till Support
                  </Button>
                </div>
              )}

              <Separator />

              {/* Comments */}
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  Comments
                  {comments.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {comments.length}
                    </Badge>
                  )}
                </h4>

                {isLoadingComments ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No comments yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((comment) => (
                      <div key={comment.id} className="flex gap-2">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          {comment.profile?.avatar_url ? (
                            <img
                              src={comment.profile.avatar_url}
                              alt=""
                              className="w-full h-full rounded-full object-cover"
                            />
                          ) : (
                            <User className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium">
                              {comment.profile?.display_name || 'User'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(comment.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {comment.comment}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          {/* Comment input */}
          <div className="flex-shrink-0 pt-4 border-t space-y-2">
            <Textarea
              placeholder="Write a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={2}
              disabled={isSubmittingComment}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSubmitComment}
                disabled={!newComment.trim() || isSubmittingComment}
              >
                {isSubmittingComment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {issue && createPortal(
        <SendIssueDialog
          open={showSendDialog}
          onClose={() => setShowSendDialog(false)}
          issueId={issue.id}
          issueTitle={issue.title}
        />,
        document.body
      )}
    </>
  );
};

export default IssueDetailSheet;
