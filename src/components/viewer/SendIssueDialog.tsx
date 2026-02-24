import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface UserProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface SendIssueDialogProps {
  open: boolean;
  onClose: () => void;
  issueId: string;
  issueTitle: string;
}

const SendIssueDialog: React.FC<SendIssueDialogProps> = ({
  open,
  onClose,
  issueId,
  issueTitle,
}) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setIsLoading(true);
    supabase
      .from("profiles")
      .select("user_id, display_name, avatar_url")
      .then(({ data }) => {
        setUsers(data || []);
        setIsLoading(false);
      });
  }, [open]);

  const toggleUser = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) return;
    setIsSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      const { data, error } = await supabase.functions.invoke("send-issue-email", {
        body: {
          issue_id: issueId,
          user_ids: Array.from(selectedIds),
        },
      });

      if (error) throw error;

      toast({
        title: "Issue sent",
        description: `Sent to ${data?.sent || selectedIds.size} user(s)`,
      });
      onClose();
    } catch (err: any) {
      console.error("Failed to send issue:", err);
      toast({
        title: "Failed to send",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Issue</DialogTitle>
          <DialogDescription>
            Select users to notify about "{issueTitle}"
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-60">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No users found
            </p>
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <label
                  key={u.user_id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.has(u.user_id)}
                    onCheckedChange={() => toggleUser(u.user_id)}
                  />
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <User className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-sm">{u.display_name || "User"}</span>
                </label>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={selectedIds.size === 0 || isSending}
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="h-4 w-4 mr-1" />
                Send ({selectedIds.size})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SendIssueDialog;
