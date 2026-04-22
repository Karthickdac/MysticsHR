import { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("mysticshr.sidebarCollapsed") === "1";
  });
  const [commandOpen, setCommandOpen] = useState(false);
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("mysticshr.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  const [provisionAttempted, setProvisionAttempted] = useState(false);
  const { isLoading, isNotProvisioned } = useCurrentHrmsUser();
  const { getToken, isSignedIn } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!isNotProvisioned || provisionAttempted || !isSignedIn) return;

    setProvisionAttempted(true);
    setProvisioning(true);

    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setProvisioning(false);
          return;
        }
        const res = await fetch(`${BASE_URL}/api/auth/provision`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (res.ok) {
          await qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        }
      } catch {
        // provision attempt failed silently; user will see "not provisioned" message
      } finally {
        setProvisioning(false);
      }
    })();
  }, [isNotProvisioned, provisionAttempted, isSignedIn, getToken, qc]);

  if (isLoading || provisioning) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          {provisioning && (
            <p className="text-sm text-muted-foreground">Verifying your account…</p>
          )}
        </div>
      </div>
    );
  }

  if (isNotProvisioned) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-lg">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Account Not Provisioned</AlertTitle>
            <AlertDescription>
              No HRMS account found for your email address. Please contact your HR administrator to create your profile and assign access.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-muted/30 overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        setOpen={setSidebarOpen}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onMobileMenuOpen={() => setSidebarOpen(true)}
          onCommandOpen={() => setCommandOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto w-full max-w-7xl">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
