import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { 
  LayoutDashboard, 
  Users, 
  Building2, 
  Briefcase, 
  ShieldCheck, 
  FileText, 
  Settings,
  LogOut,
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

export function Sidebar({ isOpen, setOpen }: { isOpen: boolean; setOpen: (v: boolean) => void }) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: currentUser } = useGetCurrentUser({ query: { enabled: !!user?.id, retry: false, queryKey: getGetCurrentUserQueryKey() } });

  const role = currentUser?.role || "employee";

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] },
    { name: "Employees", href: "/employees", icon: Users, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] },
    { name: "Departments", href: "/departments", icon: Building2, roles: ["super_admin", "hr_manager", "hr_executive"] },
    { name: "Designations", href: "/designations", icon: Briefcase, roles: ["super_admin", "hr_manager", "hr_executive"] },
    { name: "Users", href: "/users", icon: ShieldCheck, roles: ["super_admin"] },
    { name: "Audit Logs", href: "/audit-logs", icon: FileText, roles: ["super_admin", "hr_manager"] },
    { name: "Settings", href: "/settings", icon: Settings, roles: ["super_admin", "hr_manager"] },
  ];

  const filteredNav = navItems.filter((item) => item.roles.includes(role));

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden" 
          onClick={() => setOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border text-sidebar-foreground transition-transform duration-200 ease-in-out flex flex-col md:translate-x-0 md:static",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl text-sidebar-primary">
            <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="MysticsHR" className="w-8 h-8" />
            MysticsHR
          </Link>
          <Button variant="ghost" size="icon" className="md:hidden text-sidebar-foreground" onClick={() => setOpen(false)}>
            <Menu className="w-5 h-5" />
          </Button>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {filteredNav.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.name} href={item.href}>
                <div 
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
                    isActive 
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                  onClick={() => setOpen(false)}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-sidebar-primary/20 flex items-center justify-center text-sidebar-primary font-bold overflow-hidden">
              {user?.imageUrl ? (
                <img src={user.imageUrl} alt={currentUser?.name || user?.fullName || ""} className="w-full h-full object-cover" />
              ) : (
                (currentUser?.name || user?.fullName || "U").charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{currentUser?.name || user?.fullName}</div>
              <div className="text-xs text-sidebar-foreground/60 truncate capitalize">{role.replace("_", " ")}</div>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            onClick={() => signOut(() => setLocation("/"))}
          >
            <LogOut className="w-5 h-5 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </>
  );
}
