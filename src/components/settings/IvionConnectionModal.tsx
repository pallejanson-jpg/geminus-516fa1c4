import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Copy,
  Key,
  TestTube2,
  Shield
} from 'lucide-react';

interface IvionConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
}

type ConnectionStatus = 'idle' | 'testing' | 'valid' | 'invalid' | 'expired';

// Parse JWT to get expiry info
function parseJwtExpiry(token: string): { expiresAt: Date | null; isExpired: boolean; minutesRemaining: number } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { expiresAt: null, isExpired: true, minutesRemaining: 0 };
    
    const payload = JSON.parse(atob(parts[1]));
    const exp = payload.exp;
    if (!exp) return { expiresAt: null, isExpired: true, minutesRemaining: 0 };
    
    const expiresAt = new Date(exp * 1000);
    const now = new Date();
    const isExpired = now >= expiresAt;
    const minutesRemaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 60000));
    
    return { expiresAt, isExpired, minutesRemaining };
  } catch {
    return { expiresAt: null, isExpired: true, minutesRemaining: 0 };
  }
}

const IvionConnectionModal: React.FC<IvionConnectionModalProps> = ({ 
  isOpen, 
  onClose,
  onConnected 
}) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [testResult, setTestResult] = useState<{ message: string; siteCount?: number } | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<{ isExpired: boolean; minutesRemaining: number } | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('idle');
      setAccessToken('');
      setRefreshToken('');
      setTestResult(null);
      setTokenExpiry(null);
    }
  }, [isOpen]);

  // Update expiry info when access token changes
  useEffect(() => {
    if (accessToken.trim()) {
      const { isExpired, minutesRemaining } = parseJwtExpiry(accessToken);
      setTokenExpiry({ isExpired, minutesRemaining });
      if (isExpired) {
        setStatus('expired');
      } else if (status === 'expired') {
        setStatus('idle');
      }
    } else {
      setTokenExpiry(null);
      if (status === 'expired') {
        setStatus('idle');
      }
    }
  }, [accessToken, status]);

  // Test the provided token
  const handleTestConnection = useCallback(async () => {
    if (!accessToken.trim()) {
      toast({
        variant: 'destructive',
        title: 'Token Required',
        description: 'Please enter an access token to test.',
      });
      return;
    }

    setStatus('testing');
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: { 
          action: 'validate-token',
          access_token: accessToken.trim()
        }
      });

      if (error) throw error;

      if (data?.success) {
        setStatus('valid');
        setTestResult({
          message: data.message || 'Token is valid!',
          siteCount: data.siteCount,
        });
        toast({
          title: 'Token Valid!',
          description: `Found ${data.siteCount} sites in Ivion.`,
        });
      } else {
        setStatus('invalid');
        setTestResult({
          message: data?.error || 'Token validation failed',
        });
        toast({
          variant: 'destructive',
          title: 'Invalid Token',
          description: data?.error || 'The token could not be validated.',
        });
      }
    } catch (e: any) {
      setStatus('invalid');
      setTestResult({
        message: e.message || 'Connection test failed',
      });
      toast({
        variant: 'destructive',
        title: 'Test Failed',
        description: e.message,
      });
    }
  }, [accessToken, toast]);

  // Copy token to clipboard
  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: `${label} copied to clipboard.`,
    });
  }, [toast]);

  // Handle save completion
  const handleSaveComplete = useCallback(() => {
    toast({
      title: 'Connection Complete',
      description: 'Update your Cloud secrets with the tokens to persist the connection.',
    });
    onConnected?.();
    onClose();
  }, [toast, onConnected, onClose]);

  // Render status badge
  const renderStatusBadge = () => {
    switch (status) {
      case 'idle':
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Ready</Badge>;
      case 'testing':
        return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Testing...</Badge>;
      case 'valid':
        return <Badge className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />Valid</Badge>;
      case 'invalid':
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Invalid</Badge>;
      case 'expired':
        return <Badge variant="destructive" className="gap-1"><Clock className="h-3 w-3" />Expired</Badge>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Connect to NavVis IVION
          </DialogTitle>
          <DialogDescription>
            Paste your NavVis access token below. You can get this from the NavVis admin panel or use an existing JWT token.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Access Token Input */}
          <div className="space-y-2">
            <Label htmlFor="access-token" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Access Token
            </Label>
            <div className="flex gap-2">
              <Input
                id="access-token"
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiJ9..."
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="font-mono text-sm"
              />
              {accessToken && (
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => copyToClipboard(accessToken, 'Access Token')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
            {tokenExpiry && (
              <p className={`text-xs ${tokenExpiry.isExpired ? 'text-destructive' : 'text-muted-foreground'}`}>
                {tokenExpiry.isExpired 
                  ? '⚠️ Token expired!'
                  : `✓ Valid for ~${tokenExpiry.minutesRemaining} minutes`}
              </p>
            )}
          </div>

          {/* Refresh Token Input (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="refresh-token" className="flex items-center gap-2 text-muted-foreground">
              <Key className="h-4 w-4" />
              Refresh Token (optional)
            </Label>
            <div className="flex gap-2">
              <Input
                id="refresh-token"
                type="password"
                placeholder="For automatic token renewal (~7 days validity)"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                className="font-mono text-sm"
              />
              {refreshToken && (
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => copyToClipboard(refreshToken, 'Refresh Token')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Save as IVION_REFRESH_TOKEN for automatic renewal
            </p>
          </div>

          {/* Test Connection Button */}
          <Button 
            onClick={handleTestConnection} 
            disabled={!accessToken.trim() || status === 'testing'}
            className="w-full gap-2"
            variant={status === 'valid' ? 'outline' : 'default'}
          >
            {status === 'testing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TestTube2 className="h-4 w-4" />
            )}
            Test Connection
          </Button>

          {/* Status & Test Result */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status:</span>
            {renderStatusBadge()}
          </div>

          {testResult && (
            <div className={`p-3 rounded-lg border ${
              status === 'valid' 
                ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900' 
                : 'bg-destructive/10 border-destructive/20'
            }`}>
              <p className={`text-sm ${
                status === 'valid' 
                  ? 'text-green-700 dark:text-green-300' 
                  : 'text-destructive'
              }`}>
                {testResult.message}
                {testResult.siteCount !== undefined && (
                  <span className="block mt-1 font-medium">
                    Found {testResult.siteCount} site{testResult.siteCount !== 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Instructions for saving to secrets */}
          {status === 'valid' && (
            <div className="p-3 bg-muted rounded-lg border">
              <p className="text-sm text-muted-foreground">
                <strong>Next steps:</strong> Update your Cloud secrets to persist this connection:
              </p>
              <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                <li>IVION_ACCESS_TOKEN - The token you just tested</li>
                {refreshToken && <li>IVION_REFRESH_TOKEN - For automatic renewal</li>}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveComplete}
            disabled={status !== 'valid'}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default IvionConnectionModal;