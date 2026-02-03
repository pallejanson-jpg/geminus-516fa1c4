import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  ExternalLink, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Copy,
  RefreshCw,
  Key
} from 'lucide-react';

interface IvionConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
}

type ConnectionStatus = 'idle' | 'requesting' | 'waiting' | 'exchanging' | 'success' | 'error' | 'expired';

interface MandateState {
  authorization_token: string;
  exchange_token: string;
  authorization_url: string;
}

const IvionConnectionModal: React.FC<IvionConnectionModalProps> = ({ 
  isOpen, 
  onClose,
  onConnected 
}) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [mandateState, setMandateState] = useState<MandateState | null>(null);
  const [tokens, setTokens] = useState<{ access_token?: string; refresh_token?: string } | null>(null);
  const pollingRef = useRef<number | null>(null);
  const popupRef = useRef<Window | null>(null);

  // Cleanup polling on unmount or close
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    };
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('idle');
      setErrorMessage('');
      setMandateState(null);
      setTokens(null);
    }
  }, [isOpen]);

  // Start the mandate flow
  const handleStartConnection = useCallback(async () => {
    setStatus('requesting');
    setErrorMessage('');

    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: { action: 'mandate-request' }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to request mandate');

      setMandateState({
        authorization_token: data.authorization_token,
        exchange_token: data.exchange_token,
        authorization_url: data.authorization_url,
      });

      // Open popup with authorization URL
      const popup = window.open(
        data.authorization_url,
        'ivion-auth',
        'width=600,height=700,menubar=no,toolbar=no,location=yes,status=yes'
      );
      popupRef.current = popup;

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      setStatus('waiting');

      // Start polling for authorization
      pollingRef.current = window.setInterval(async () => {
        try {
          const { data: validateData, error: validateError } = await supabase.functions.invoke('ivion-poi', {
            body: { 
              action: 'mandate-validate',
              authorization_token: data.authorization_token
            }
          });

          if (validateError) {
            console.error('Validation error:', validateError);
            return;
          }

          if (validateData?.expired) {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setStatus('expired');
            setErrorMessage('Authorization expired. Please try again.');
            return;
          }

          if (validateData?.authorized) {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            
            // Close popup if still open
            if (popupRef.current && !popupRef.current.closed) {
              popupRef.current.close();
            }

            // Exchange for tokens
            await handleExchange(data.exchange_token);
          }
        } catch (e) {
          console.error('Polling error:', e);
        }
      }, 2000); // Poll every 2 seconds

    } catch (e: any) {
      setStatus('error');
      setErrorMessage(e.message || 'Failed to start connection');
      toast({
        variant: 'destructive',
        title: 'Connection Error',
        description: e.message,
      });
    }
  }, [toast]);

  // Exchange mandate for tokens
  const handleExchange = useCallback(async (exchangeToken: string) => {
    setStatus('exchanging');

    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: { 
          action: 'mandate-exchange',
          exchange_token: exchangeToken
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to exchange mandate');

      setTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      setStatus('success');

      toast({
        title: 'Connected to NavVis IVION',
        description: 'Tokens obtained successfully. Copy them to Cloud secrets to persist.',
      });

      onConnected?.();

    } catch (e: any) {
      setStatus('error');
      setErrorMessage(e.message || 'Failed to exchange tokens');
      toast({
        variant: 'destructive',
        title: 'Exchange Error',
        description: e.message,
      });
    }
  }, [toast, onConnected]);

  // Copy token to clipboard
  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: `${label} copied to clipboard.`,
    });
  }, [toast]);

  // Render status badge
  const renderStatusBadge = () => {
    switch (status) {
      case 'idle':
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Ready</Badge>;
      case 'requesting':
        return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Requesting...</Badge>;
      case 'waiting':
        return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Waiting for approval...</Badge>;
      case 'exchanging':
        return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Exchanging tokens...</Badge>;
      case 'success':
        return <Badge className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />Connected</Badge>;
      case 'error':
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Error</Badge>;
      case 'expired':
        return <Badge variant="destructive" className="gap-1"><Clock className="h-3 w-3" />Expired</Badge>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Connect to NavVis IVION
          </DialogTitle>
          <DialogDescription>
            Authorize access using the NavVis OAuth flow. A popup window will open for authentication.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status:</span>
            {renderStatusBadge()}
          </div>

          {/* Idle state - show connect button */}
          {status === 'idle' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Click the button below to open NavVis IVION and authorize access. 
                You'll need to log in to your NavVis account and click "Allow".
              </p>
              <Button 
                onClick={handleStartConnection} 
                className="w-full gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Open NavVis for Authorization
              </Button>
            </div>
          )}

          {/* Waiting state */}
          {status === 'waiting' && (
            <div className="space-y-3">
              <div className="flex items-center justify-center py-4">
                <div className="text-center space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Waiting for you to approve in the popup window...
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                If the popup was blocked, click below to try again.
              </p>
              <Button 
                variant="outline" 
                onClick={() => {
                  if (mandateState?.authorization_url) {
                    popupRef.current = window.open(
                      mandateState.authorization_url,
                      'ivion-auth',
                      'width=600,height=700,menubar=no,toolbar=no,location=yes,status=yes'
                    );
                  }
                }}
                className="w-full gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Reopen Authorization Window
              </Button>
            </div>
          )}

          {/* Error state */}
          {(status === 'error' || status === 'expired') && (
            <div className="space-y-3">
              <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                <p className="text-sm text-destructive">{errorMessage}</p>
              </div>
              <Button 
                onClick={handleStartConnection} 
                className="w-full gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            </div>
          )}

          {/* Success state - show tokens */}
          {status === 'success' && tokens && (
            <div className="space-y-4">
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                <p className="text-sm text-green-700 dark:text-green-300">
                  Successfully connected! Copy the tokens below and save them to your Cloud secrets to persist the connection.
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    IVION_ACCESS_TOKEN
                  </label>
                  <div className="flex gap-2">
                    <code className="flex-1 text-xs bg-muted p-2 rounded border font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                      {tokens.access_token?.substring(0, 50)}...
                    </code>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => copyToClipboard(tokens.access_token!, 'Access Token')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Valid for ~30 minutes</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    IVION_REFRESH_TOKEN
                  </label>
                  <div className="flex gap-2">
                    <code className="flex-1 text-xs bg-muted p-2 rounded border font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                      {tokens.refresh_token?.substring(0, 50)}...
                    </code>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => copyToClipboard(tokens.refresh_token!, 'Refresh Token')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Valid for ~7 days</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {status === 'success' ? 'Done' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default IvionConnectionModal;
