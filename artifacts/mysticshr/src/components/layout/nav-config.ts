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
  Clock,
  CalendarCheck,
  Umbrella,
  Timer,
  Banknote,
  Target,
  Home,
  Ticket,
  FileBadge,
  TrendingDown,
  BarChart3,
  Bell,
  Network,
  LifeBuoy,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type Role =
  | "super_admin"
  | "hr_manager"
  | "hr_executive"
  | "hod"
  | "payroll_admin"
  | "employee";

export const ALL_ROLES: Role[] = [
  "super_admin",
  "hr_manager",
  "hr_executive",
  "hod",
  "payroll_admin",
  "employee",
];

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  /** Extra search keywords surfaced by the command palette. */
  keywords?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  /** Collapsed by default? Keep top groups open, admin groups closed. */
  defaultOpen?: boolean;
  items: NavItem[];
}

/**
 * The full navigation tree, organized SAP-style into business-domain groups.
 * The same tree powers the sidebar, the breadcrumb resolver, and the
 * command palette — keep everything declared here.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "Home",
    defaultOpen: true,
    items: [
      {
        name: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        roles: ALL_ROLES,
        keywords: ["overview", "home", "kpi"],
      },
      {
        name: "ESS Portal",
        href: "/ess",
        icon: Home,
        roles: ALL_ROLES,
        keywords: ["self service", "my profile", "employee"],
      },
    ],
  },
  {
    id: "workforce",
    label: "Workforce",
    defaultOpen: true,
    items: [
      {
        name: "Employees",
        href: "/employees",
        icon: Users,
        roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"],
        keywords: ["staff", "people", "team"],
      },
      {
        name: "Org Chart",
        href: "/org-chart",
        icon: Network,
        roles: ALL_ROLES,
        keywords: ["organization", "hierarchy", "reporting"],
      },
      {
        name: "Departments",
        href: "/departments",
        icon: Building2,
        roles: ["super_admin", "hr_manager", "hr_executive"],
        keywords: ["division", "unit"],
      },
      {
        name: "Designations",
        href: "/designations",
        icon: Briefcase,
        roles: ["super_admin", "hr_manager", "hr_executive"],
        keywords: ["job title", "role", "position"],
      },
    ],
  },
  {
    id: "talent",
    label: "Talent Acquisition",
    defaultOpen: false,
    items: [
      {
        name: "Recruitment",
        href: "/recruitment",
        icon: UserPlus,
        roles: ["super_admin", "hr_manager", "hr_executive", "hod"],
        keywords: ["hiring", "requisition", "candidate", "job"],
      },
      {
        name: "Pre-Onboarding",
        href: "/pre-onboarding",
        icon: ClipboardCheck,
        roles: ["super_admin", "hr_manager", "hr_executive"],
        keywords: ["offer", "joining", "documents"],
      },
      {
        name: "Onboarding",
        href: "/onboarding",
        icon: ClipboardList,
        roles: ["super_admin", "hr_manager", "hr_executive", "hod"],
        keywords: ["induction", "joinee", "checklist"],
      },
    ],
  },
  {
    id: "time",
    label: "Time & Attendance",
    defaultOpen: false,
    items: [
      {
        name: "Shifts",
        href: "/shifts",
        icon: Clock,
        roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"],
        keywords: ["roster", "schedule"],
      },
      {
        name: "Attendance",
        href: "/attendance",
        icon: CalendarCheck,
        roles: ALL_ROLES,
        keywords: ["punch", "regularization", "muster"],
      },
      {
        name: "Leave",
        href: "/leave",
        icon: Umbrella,
        roles: ALL_ROLES,
        keywords: ["holiday", "time off", "vacation"],
      },
      {
        name: "Permissions",
        href: "/permissions",
        icon: Timer,
        roles: ALL_ROLES,
        keywords: ["short leave", "outdoor", "comp off"],
      },
    ],
  },
  {
    id: "payroll",
    label: "Payroll",
    defaultOpen: false,
    items: [
      {
        name: "Payroll",
        href: "/payroll",
        icon: Banknote,
        roles: ["super_admin", "hr_manager", "hr_executive", "payroll_admin", "employee"],
        keywords: ["salary", "payslip", "tax", "ctc"],
      },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    defaultOpen: false,
    items: [
      {
        name: "Performance",
        href: "/performance",
        icon: Target,
        roles: ["super_admin", "hr_manager", "hr_executive", "hod", "employee"],
        keywords: ["goals", "appraisal", "review", "kra"],
      },
    ],
  },
  {
    id: "services",
    label: "Employee Services",
    defaultOpen: false,
    items: [
      {
        name: "Helpdesk",
        href: "/helpdesk",
        icon: Ticket,
        roles: ALL_ROLES,
        keywords: ["ticket", "support", "issue", "sla"],
      },
      {
        name: "Documents",
        href: "/documents",
        icon: FileBadge,
        roles: ALL_ROLES,
        keywords: ["files", "letters", "certificates"],
      },
      {
        name: "Communications",
        href: "/communications",
        icon: Bell,
        roles: ["super_admin", "hr_manager"],
        keywords: ["announcements", "notifications", "broadcast"],
      },
    ],
  },
  {
    id: "exit",
    label: "Separation",
    defaultOpen: false,
    items: [
      {
        name: "Exit & Offboarding",
        href: "/exit",
        icon: TrendingDown,
        roles: ALL_ROLES,
        keywords: ["resignation", "clearance", "fnf", "relieving"],
      },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    defaultOpen: false,
    items: [
      {
        name: "Analytics",
        href: "/analytics",
        icon: BarChart3,
        roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"],
        keywords: ["dashboard", "metrics", "charts"],
      },
      {
        name: "Reports",
        href: "/reports",
        icon: FileText,
        roles: ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"],
        keywords: ["export", "download", "summary"],
      },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    defaultOpen: false,
    items: [
      {
        name: "Users",
        href: "/users",
        icon: ShieldCheck,
        roles: ["super_admin", "hr_manager"],
        keywords: ["roles", "access", "rbac"],
      },
      {
        name: "Audit Logs",
        href: "/audit-logs",
        icon: FileText,
        roles: ["super_admin", "hr_manager"],
        keywords: ["activity", "trail", "history"],
      },
      {
        name: "Settings",
        href: "/settings",
        icon: Settings,
        roles: ["super_admin", "hr_manager"],
        keywords: ["configuration", "preferences", "system"],
      },
    ],
  },
];

/** Flat list of all items, useful for command-palette search & breadcrumbs. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Resolve which item a given pathname belongs to (longest-prefix match). */
export function resolveActiveItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best;
}

/** Filter the nav tree by role, dropping any group that ends up empty. */
export function filterNavByRole(role: Role): NavGroup[] {
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) }))
    .filter((g) => g.items.length > 0);
}
