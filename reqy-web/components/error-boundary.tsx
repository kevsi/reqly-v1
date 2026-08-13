"use client";

import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { withTranslation } from "react-i18next";
import type { WithTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps extends WithTranslation {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryBase extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMessage = this.state.error?.message || this.props.t("error.unexpected");
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="size-8 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">{this.props.t("error.title")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{errorMessage}</p>
          {this.state.error?.stack && (
            <details className="max-w-lg text-left">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                {this.props.t("error.details")}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <div className="flex gap-3">
            <Button
              onClick={() => this.setState({ hasError: false, error: null })}
              variant="outline"
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              {this.props.t("error.retry")}
            </Button>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              {this.props.t("error.reloadPage")}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryBase);
