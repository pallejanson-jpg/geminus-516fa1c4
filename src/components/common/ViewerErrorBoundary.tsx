import React, { Component, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ViewerErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ViewerErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary for 3D Viewer components.
 * Catches synchronous rendering errors from AssetPlusViewer and its child components,
 * preventing a full white-screen crash. Displays a recovery UI with a retry option.
 */
class ViewerErrorBoundary extends Component<ViewerErrorBoundaryProps, ViewerErrorBoundaryState> {
  constructor(props: ViewerErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ViewerErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ViewerErrorBoundary] 3D Viewer crashed:', error);
    console.error('[ViewerErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-background p-6">
          <div className="text-center max-w-md space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-lg font-semibold text-foreground">
              3D Viewer Crashed
            </h2>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred in the 3D engine. This may be due to limited GPU memory on your device.
            </p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground/70 font-mono bg-muted rounded p-2 break-all">
                {this.state.error.message.slice(0, 200)}
              </p>
            )}
            <Button onClick={this.handleReset} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ViewerErrorBoundary;
