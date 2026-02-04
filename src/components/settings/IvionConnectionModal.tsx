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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  Server,
  User,
  Key,
  Shield
} from 'lucide-react';
import GeoreferencingSettings from './GeoreferencingSettings';

interface IvionConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
  buildingFmGuid?: string | null;
}

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error';

interface ConfigStatus {
  hasApiUrl: boolean;
  hasCredentials: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  apiUrlPreview: string;
  usernamePreview: string;
}

interface TestResult {
  success: boolean;
  message: string;
  siteCount?: number;
  authMethod?: string;
}

const IvionConnectionModal: React.FC<IvionConnectionModalProps> = ({ 
  isOpen, 
  onClose,
  onConnected,
  buildingFmGuid 
}) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // Load configuration status when modal opens
  useEffect(() => {
    if (isOpen) {
      loadConfigStatus();
    }
  }, [isOpen]);

  // Load config status from edge function
  const loadConfigStatus = useCallback(async () => {
    setIsLoadingConfig(true);
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: { action: 'get-config-status' }
      });

      if (error) throw error;
      setConfigStatus(data);
    } catch (e: any) {
      console.error('Failed to load config status:', e);
      // Set default status if we can't load
      setConfigStatus({
        hasApiUrl: false,
        hasCredentials: false,
        hasAccessToken: false,
        hasRefreshToken: false,
        apiUrlPreview: '',
        usernamePreview: '',
      });
    } finally {
      setIsLoadingConfig(false);
    }
  }, []);

  // Test connection with automatic authentication
  const handleTestConnection = useCallback(async () => {
    setStatus('testing');
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: { 
          action: 'test-connection-auto',
          buildingFmGuid
        }
      });

      if (error) throw error;

      if (data?.success) {
        setStatus('connected');
        setTestResult({
          success: true,
          message: data.message || 'Connected successfully!',
          siteCount: data.siteCount,
          authMethod: data.authMethod,
        });
        toast({
          title: 'Ivion Connected!',
          description: data.message,
        });
      } else {
        setStatus('error');
        setTestResult({
          success: false,
          message: data?.message || 'Connection failed',
        });
        toast({
          variant: 'destructive',
          title: 'Connection Failed',
          description: data?.message || 'Could not connect to Ivion.',
        });
      }
    } catch (e: any) {
      setStatus('error');
      setTestResult({
        success: false,
        message: e.message || 'Connection test failed',
      });
      toast({
        variant: 'destructive',
        title: 'Test Failed',
        description: e.message,
      });
    }
  }, [buildingFmGuid, toast]);

  // Handle close
  const handleClose = useCallback(() => {
    if (status === 'connected') {
      onConnected?.();
    }
    setStatus('idle');
    setTestResult(null);
    onClose();
  }, [status, onConnected, onClose]);

  // Render status badge
  const renderStatusBadge = () => {
    switch (status) {
      case 'idle':
        return <Badge variant="outline" className="gap-1">Ready to test</Badge>;
      case 'testing':
        return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Testing...</Badge>;
      case 'connected':
        return <Badge className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />Connected</Badge>;
      case 'error':
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Error</Badge>;
      default:
        return null;
    }
  };

  const isConfigured = configStatus?.hasApiUrl && (configStatus?.hasCredentials || configStatus?.hasAccessToken);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            NavVis IVION Connection
          </DialogTitle>
          <DialogDescription>
            {isConfigured 
              ? 'Credentials are configured. Click Test to verify the connection.'
              : 'Configure IVION_USERNAME and IVION_PASSWORD in Cloud secrets to enable automatic authentication.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Configuration Status */}
          {isLoadingConfig ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading configuration...
            </div>
          ) : configStatus ? (
            <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-medium">Configuration Status</h4>
              
              <div className="grid gap-2 text-sm">
                {/* API URL */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span>API URL</span>
                  </div>
                  {configStatus.hasApiUrl ? (
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {configStatus.apiUrlPreview}
                    </span>
                  ) : (
                    <span className="text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Not set
                    </span>
                  )}
                </div>

                {/* Username/Password */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>Username/Password</span>
                  </div>
                  {configStatus.hasCredentials ? (
                    <span className="text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {configStatus.usernamePreview}
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Not set
                    </span>
                  )}
                </div>

                {/* Legacy tokens */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <span>Legacy Tokens</span>
                  </div>
                  {configStatus.hasAccessToken || configStatus.hasRefreshToken ? (
                    <span className="text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Available (fallback)
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
              </div>

              {!isConfigured && (
                <p className="text-xs text-muted-foreground mt-2">
                  Set IVION_API_URL, IVION_USERNAME, and IVION_PASSWORD in Cloud secrets.
                </p>
              )}
            </div>
          ) : null}

          {/* Test Connection Button */}
          <Button 
            onClick={handleTestConnection} 
            disabled={!isConfigured || status === 'testing'}
            className="w-full gap-2"
            variant={status === 'connected' ? 'outline' : 'default'}
          >
            {status === 'testing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {status === 'connected' ? 'Test Again' : 'Test Connection'}
          </Button>

          {/* Status Display */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status:</span>
            {renderStatusBadge()}
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`p-3 rounded-lg border ${
              testResult.success 
                ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900' 
                : 'bg-destructive/10 border-destructive/20'
            }`}>
              <p className={`text-sm ${
                testResult.success 
                  ? 'text-green-700 dark:text-green-300' 
                  : 'text-destructive'
              }`}>
                {testResult.message}
                {testResult.siteCount !== undefined && testResult.success && (
                  <span className="block mt-1 font-medium">
                    Found {testResult.siteCount} site{testResult.siteCount !== 1 ? 's' : ''}
                  </span>
                )}
                {testResult.authMethod && testResult.success && (
                  <span className="block text-xs mt-1 opacity-70">
                    Authenticated via {testResult.authMethod}
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Success message */}
          {status === 'connected' && (
            <div className="p-3 bg-muted rounded-lg border">
              <p className="text-sm text-muted-foreground">
                <strong>✓ Connection established!</strong> Tokens are cached automatically.
                AI scanning and other Ivion features are now ready to use.
              </p>
            </div>
          )}

          {/* Georeferencing Settings - show when building is specified */}
          {buildingFmGuid && (
            <GeoreferencingSettings 
              buildingFmGuid={buildingFmGuid}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {status === 'connected' ? 'Done' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default IvionConnectionModal;
