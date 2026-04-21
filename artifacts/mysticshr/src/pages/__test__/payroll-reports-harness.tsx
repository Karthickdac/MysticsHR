import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StatutoryReports from "../payroll/reports";

declare global {
  interface Window {
    __reportsHarnessReady?: boolean;
  }
}

// Use a fresh QueryClient so the harness doesn't share state with the main app
// (it runs at a separate dev-only route and doesn't depend on auth provisioning).
const harnessQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
});

export default function PayrollReportsHarness() {
  useEffect(() => {
    window.__reportsHarnessReady = true;
    return () => { window.__reportsHarnessReady = false; };
  }, []);

  return (
    <div data-testid="payroll-reports-harness">
      <QueryClientProvider client={harnessQueryClient}>
        <StatutoryReports />
      </QueryClientProvider>
    </div>
  );
}
