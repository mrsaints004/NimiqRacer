import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            background: "linear-gradient(135deg, #1a3a5c 0%, #2266cc 100%)",
            color: "white",
            textAlign: "center",
            padding: "20px",
          }}
        >
          <div style={{ maxWidth: "500px" }}>
            <h1 style={{ fontSize: "32px", marginBottom: "16px" }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: "16px", opacity: 0.8, marginBottom: "24px" }}>
              The game encountered an error. Try reloading.
            </p>
            {this.state.error && (
              <details
                style={{
                  background: "rgba(0,0,0,0.3)",
                  padding: "12px",
                  borderRadius: "8px",
                  marginBottom: "24px",
                  textAlign: "left",
                  fontSize: "13px",
                  fontFamily: "monospace",
                }}
              >
                <summary style={{ cursor: "pointer", color: "#ffd700" }}>
                  Error Details
                </summary>
                <p style={{ color: "#ff6b6b", marginTop: "8px" }}>
                  {this.state.error.message}
                </p>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#22cc88",
                border: "none",
                color: "#111",
                padding: "14px 28px",
                fontSize: "16px",
                borderRadius: "10px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              Reload Game
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
