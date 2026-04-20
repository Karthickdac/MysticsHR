import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./Sidebar";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useUser();
  const { data: currentUser, error, isLoading } = useGetCurrentUser({ 
    query: { 
      enabled: !!user?.id, 
      retry: false,
      queryKey: getGetCurrentUserQueryKey(),
    } 
  });

  const isUnregistered = error && (error as any).status === 404;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar isOpen={sidebarOpen} setOpen={setSidebarOpen} />
      
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-background flex items-center px-4 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="ml-4 font-bold text-lg text-primary">MysticsHR</div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {isUnregistered ? (
            <div className="max-w-2xl mx-auto mt-8">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Account Not Provisioned</AlertTitle>
                <AlertDescription>
                  Your account is not yet provisioned in the HRMS. Please contact your HR administrator to set up your profile and assign appropriate roles.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-7xl">
              {children}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
