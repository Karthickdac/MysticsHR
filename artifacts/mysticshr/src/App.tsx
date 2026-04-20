import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect, Link } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ShieldAlert } from "lucide-react";

import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import EmployeesPage from "@/pages/employees/index";
import EmployeeDetailPage from "@/pages/employees/detail";
import DepartmentsPage from "@/pages/departments";
import DesignationsPage from "@/pages/designations";
import UsersPage from "@/pages/users";
import AuditLogsPage from "@/pages/audit-logs";
import RecruitmentPage from "@/pages/recruitment/index";
import RequisitionDetailPage from "@/pages/recruitment/requisition-detail";
import CandidateDetailPage from "@/pages/recruitment/candidate-detail";
import PreOnboardingPage from "@/pages/pre-onboarding/index";
import PreOnboardingDetailPage from "@/pages/pre-onboarding/detail";
import { MainLayout } from "@/components/layout/MainLayout";
import { useCurrentHrmsUser, type HrmsRole, hasRole } from "@/lib/useCurrentHrmsUser";

const Settings = () => (
  <div className="p-6">
    <h1 className="text-2xl font-bold">Settings</h1>
    <p className="text-muted-foreground mt-2">System settings coming soon.</p>
  </div>
);

const NewEmployee = () => (
  <div className="p-6">
    <h1 className="text-2xl font-bold">New Employee</h1>
    <p className="text-muted-foreground mt-2">Employee creation form coming soon.</p>
  </div>
);

function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <ShieldAlert className="w-16 h-16 text-muted-foreground" />
      <h1 className="text-2xl font-bold">Access Denied</h1>
      <p className="text-muted-foreground max-w-sm">
        You don't have permission to view this page. Contact your HR administrator if you believe this is an error.
      </p>
      <Link href="/dashboard" className="text-primary hover:underline text-sm">
        Return to Dashboard
      </Link>
    </div>
  );
}

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(222, 47%, 25%)",
    colorBackground: "hsl(210, 20%, 98%)",
    colorInputBackground: "hsl(0, 0%, 100%)",
    colorText: "hsl(220, 80%, 10%)",
    colorTextSecondary: "hsl(215, 16%, 47%)",
    colorInputText: "hsl(220, 80%, 10%)",
    colorNeutral: "hsl(210, 20%, 85%)",
    borderRadius: "0.5rem",
    fontFamily: "'Inter', sans-serif",
    fontFamilyButtons: "'Inter', sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "shadow-lg border border-[hsl(210,20%,90%)] rounded-2xl w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none bg-[hsl(210,20%,94%)]",
    headerTitle: { color: "hsl(220, 80%, 10%)" },
    headerSubtitle: { color: "hsl(215, 16%, 47%)" },
    socialButtonsBlockButtonText: { color: "hsl(220, 80%, 10%)" },
    formFieldLabel: { color: "hsl(220, 80%, 10%)", fontWeight: 500 },
    footerActionLink: { color: "hsl(222, 47%, 25%)", fontWeight: 600 },
    footerActionText: { color: "hsl(215, 16%, 47%)" },
    dividerText: { color: "hsl(215, 16%, 47%)" },
    formFieldInput: "border-[hsl(210,20%,85%)] focus:ring-[hsl(222,47%,25%)]",
    formButtonPrimary:
      "bg-[hsl(222,47%,25%)] hover:bg-[hsl(222,47%,20%)] text-[hsl(210,20%,98%)] font-semibold shadow-sm",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">
        <MainLayout>{children}</MainLayout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function RoleProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: HrmsRole[];
}) {
  const { role, isLoading, isNotProvisioned } = useCurrentHrmsUser();

  if (isLoading) return null;
  if (isNotProvisioned) return <>{children}</>;

  if (!hasRole(role, allowedRoles)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">404</h1>
        <p className="text-muted-foreground mb-4">Page not found</p>
        <Link href="/">
          <a className="text-primary hover:underline">Return Home</a>
        </Link>
      </div>
    </div>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={{
        signIn: {
          start: {
            title: "Welcome back to MysticsHR",
            subtitle: "Sign in to access the cockpit",
          },
        },
        signUp: {
          start: {
            title: "Join MysticsHR",
            subtitle: "Set up your account access",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />

          <Route path="/dashboard">
            <ProtectedRoute><DashboardPage /></ProtectedRoute>
          </Route>

          <Route path="/employees/new">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive"]}>
                <NewEmployee />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>
          <Route path="/employees/:id">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"]}>
                <EmployeeDetailPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>
          <Route path="/employees">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"]}>
                <EmployeesPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>

          <Route path="/departments">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive"]}>
                <DepartmentsPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>
          <Route path="/designations">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive"]}>
                <DesignationsPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>

          <Route path="/users">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager"]}>
                <UsersPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>

          <Route path="/recruitment/requisitions/:id">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive", "hod"]}>
                <RequisitionDetailPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>
          <Route path="/recruitment/candidates/:id">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive", "hod"]}>
                <CandidateDetailPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>
          <Route path="/recruitment">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive", "hod"]}>
                <RecruitmentPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>

          <Route path="/pre-onboarding/:id">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive"]}>
                <PreOnboardingDetailPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>
          <Route path="/pre-onboarding">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager", "hr_executive"]}>
                <PreOnboardingPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>

          <Route path="/audit-logs">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager"]}>
                <AuditLogsPage />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>

          <Route path="/settings">
            <ProtectedRoute>
              <RoleProtectedRoute allowedRoles={["super_admin", "hr_manager"]}>
                <Settings />
              </RoleProtectedRoute>
            </ProtectedRoute>
          </Route>

          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
