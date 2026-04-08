import React, { Component, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary wrapping the entire app.
 * Catches unhandled rendering errors and shows a recovery UI
 * instead of a white screen. Logs errors via the central logger
 * and can be extended to send reports to an external service.
 */
class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('[GlobalErrorBoundary] Uncaught error:', error);
    logger.error('[GlobalErrorBoundary] Component stack:', errorInfo.componentStack);

    // Future: send to Sentry / external error reporting service
    // e.g. Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6" role="alert">
          <div className="text-center max-w-md space-y-4">
            <AlertCircle className="h-14 w-14 text-destructive mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-foreground">
              Something went wrong
            </h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. You can try again or reload the page.
            </p>
            {this.state.error?.message && (
              <details className="text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  Technical details
                </summary>
                <pre className="text-xs text-muted-foreground/70 font-mono bg-muted rounded p-2 mt-1 break-all whitespace-pre-wrap max-h-32 overflow-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={this.handleReset}>
                Try Again
              </Button>
              <Button onClick={this.handleReload} className="gap-2">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
