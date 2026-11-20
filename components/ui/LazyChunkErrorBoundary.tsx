import React from "react";

interface LazyChunkErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onRetry?: () => void;
}

interface LazyChunkErrorBoundaryState {
  hasError: boolean;
}

/**
 * Prevents dynamic-import or lazy-chunk runtime errors (e.g. transient offline
 * chunk fetch failures or WebGL context loss) from crashing the parent portal.
 */
export class LazyChunkErrorBoundary extends React.Component<
  LazyChunkErrorBoundaryProps,
  LazyChunkErrorBoundaryState
> {
  state: LazyChunkErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LazyChunkErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("Lazy chunk failed to load:", error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
          Could not load this section.{" "}
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onRetry?.();
            }}
            className="underline font-bold"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
