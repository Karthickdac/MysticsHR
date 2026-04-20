import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { 
  LayoutDashboard, 
  Users, 
  Building2, 
  Briefcase, 
  UserPlus,
  ClipboardCheck,
  ClipboardList,
  ShieldCheck, 
  FileText, 
  Settings,
  LogOut,
  Menu,
  Clock,
  CalendarCheck,
  Umbrella,
  Timer,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";

export function Sidebar({ isOpen, setOpen }: { isOpen: boolean; setOpen: (v: boolean) => void }) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { hrmsUser, role: hrmsRole } = useCurrentHrmsUser();

  const role = hrmsRole ?? "employee";

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] },
    { name: "Employees", href: "/employees", icon: Users, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] },
    { name: "Recruitment", href: "/recruitment", icon: UserPlus, roles: ["super_admin", "hr_manager", "hr_executive", "hod"] },
    { name: "Pre-Onboarding", href: "/pre-onboarding", icon: ClipboardCheck, roles: ["super_admin", "hr_manager", "hr_executive"] },
    { name: "Onboarding", href: "/onboarding", icon: ClipboardList, roles: ["super_admin", "hr_manager", "hr_executive", "hod"] },
    { name: "Shifts", href: "/shifts", icon: Clock, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"] },
    { name: "Attendance", href: "/attendance", icon: CalendarCheck, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] },
    { name: "Leave", href: "/leave", icon: Umbrella, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] },
    { name: "Permissions", href: "/permissions", icon: Timer, roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] },
    { name: "Payroll", href: "/payroll", icon: Banknote, roles: ["super_admin", "hr_manager", "hr_executive", "payroll_admin", "employee"] },
    { name: "Departments", href: "/departments", icon: Building2, roles: ["super_admin", "hr_manager", "hr_executive"] },
    { name: "Designations", href: "/designations", icon: Briefcase, roles: ["super_admin", "hr_manager", "hr_executive"] },
    { name: "Users", href: "/users", icon: ShieldCheck, roles: ["super_admin", "hr_manager"] },
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
                <img src={user.imageUrl} alt={hrmsUser?.name || user?.fullName || ""} className="w-full h-full object-cover" />
              ) : (
                (hrmsUser?.name || user?.fullName || "U").charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{hrmsUser?.name || user?.fullName}</div>
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
