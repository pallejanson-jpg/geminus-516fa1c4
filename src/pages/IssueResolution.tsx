import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  Lightbulb,
  HelpCircle,
  Eye,
  CheckCircle,
  Loader2,
  Send,
  ExternalLink,
  User,
  MapPin,
  Box,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";

const ISSUE_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  fault: { label: "Fault", icon: AlertCircle, color: "text-destructive" },
  improvement: { label: "Improvement", icon: Lightbulb, color: "text-amber-500" },
  question: { label: "Question", icon: HelpCircle, color: "text-blue-500" },
  observation: { label: "Observation", icon: Eye, color: "text-muted-foreground" },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-400",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-destructive",
};

interface BcfComment {
  id: string;
  user_id: string;
  comment: string;
  created_at: string;
  profile?: { display_name: string | null };
}

const IssueResolution: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [issue, setIssue] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [comments, setComments] = useState<BcfComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    loadIssueByToken(token);
  }, [token]);

  const loadIssueByToken = async (t: string) => {
    setIsLoading(true);
    try {
      // Find assignment by token
      const { data: assignmentData, error: assignErr } = await supabase
        .from("bcf_issue_assignments")
        .select("*")
        .eq("token", t)
        .single();

      if (assignErr || !assignmentData) {
        setError("Invalid or expired link.");
        setIsLoading(false);
        return;
      }

      setAssignment(assignmentData);

      // Mark as viewed
      if (!assignmentData.viewed_at) {
        await supabase
          .from("bcf_issue_assignments")
          .update({ viewed_at: new Date().toISOString() })
          .eq("id", assignmentData.id);
      }

      // Fetch issue
      const { data: issueData, error: issueErr } = await supabase
        .from("bcf_issues")
        .select("*")
        .eq("id", assignmentData.issue_id)
        .single();

      if (issueErr || !issueData) {
        setError("Issue not found.");
        setIsLoading(false);
        return;
      }

      setIssue(issueData);

      // Fetch comments
      const { data: commentsData } = await supabase
        .from("bcf_comments")
        .select("id, user_id, comment, created_at")
        .eq("issue_id", issueData.id)
        .order("created_at", { ascending: true });

      if (commentsData && commentsData.length > 0) {
        const userIds = [...new Set(commentsData.map((c) => c.user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);

        const profileMap = new Map(profiles?.map((p) => [p.user_id, p]) || []);
        setComments(
          commentsData.map((c) => ({ ...c, profile: profileMap.get(c.user_id) }))
        );
      }
    } catch (err) {
      console.error("Failed to load issue:", err);
      setError("Failed to load issue.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !issue || !assignment) return;
    setIsSending(true);
    try {
      const { error } = await supabase.from("bcf_comments").insert({
        issue_id: issue.id,
        user_id: assignment.assigned_to_user_id,
        comment: newComment.trim(),
      });
      if (error) throw error;
      setNewComment("");
      // Reload comments
      const { data: commentsData } = await supabase
        .from("bcf_comments")
        .select("id, user_id, comment, created_at")
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: true });
      setComments(commentsData || []);
      toast({ title: "Comment added" });
    } catch (err: any) {
      toast({ title: "Failed to add comment", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const handleResolve = async () => {
    if (!issue || !assignment) return;
    setIsResolving(true);
    try {
      // Update issue status
      await supabase
        .from("bcf_issues")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: assignment.assigned_to_user_id,
        })
        .eq("id", issue.id);

      // Update assignment
      await supabase
        .from("bcf_issue_assignments")
        .update({
          responded_at: new Date().toISOString(),
          response_status: "resolved",
        })
        .eq("id", assignment.id);

      setIssue({ ...issue, status: "resolved" });
      toast({ title: "Issue marked as resolved" });
    } catch (err) {
      toast({ title: "Failed to resolve", variant: "destructive" });
    } finally {
      setIsResolving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-lg font-medium">{error || "Issue not found"}</p>
      </div>
    );
  }

  const typeConfig = ISSUE_TYPE_CONFIG[issue.issue_type] || ISSUE_TYPE_CONFIG.observation;
  const TypeIcon = typeConfig.icon;
  const isResolved = issue.status === "resolved" || issue.status === "closed";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg bg-muted ${typeConfig.color}`}>
                <TypeIcon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">{issue.title}</CardTitle>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="outline">{typeConfig.label}</Badge>
                  <Badge className={`${PRIORITY_COLORS[issue.priority] || "bg-muted"} text-white`}>
                    {issue.priority}
                  </Badge>
                  {isResolved && (
                    <Badge className="bg-emerald-500 text-white">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Resolved
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {issue.screenshot_url && (
              <img
                src={issue.screenshot_url}
                alt="Issue screenshot"
                className="w-full rounded-lg border"
              />
            )}
            {issue.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {issue.description}
              </p>
            )}
            {issue.building_name && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {issue.building_name}
              </div>
            )}
            {issue.selected_object_ids?.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-1">
                  <Box className="h-4 w-4" /> Related objects
                </div>
                <div className="flex flex-wrap gap-1">
                  {issue.selected_object_ids.map((id: string) => (
                    <Badge key={id} variant="outline" className="text-xs font-mono">
                      {id.length > 12 ? `${id.substring(0, 12)}...` : id}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Created {format(new Date(issue.created_at), "PPP")}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        {!isResolved && (
          <div className="flex gap-2">
            <Button
              onClick={handleResolve}
              disabled={isResolving}
              className="flex-1"
            >
              {isResolving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              Mark as Resolved
            </Button>
          </div>
        )}

        <Separator />

        {/* Comments */}
        <div className="space-y-4">
          <h3 className="font-medium">Comments ({comments.length})</h3>
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet</p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">
                        {c.profile?.display_name || "User"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.comment}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add comment */}
          <div className="space-y-2">
            <Textarea
              placeholder="Write a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={2}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleAddComment}
                disabled={!newComment.trim() || isSending}
              >
                {isSending ? (
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
        </div>
      </div>
    </div>
  );
};

export default IssueResolution;
