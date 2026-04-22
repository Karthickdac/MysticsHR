import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, ChevronsLeft, ChevronsRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { filterNavByRole, type Role } from "./nav-config";

interface SidebarProps {
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Sidebar({ isOpen, setOpen, collapsed, setCollapsed }: SidebarProps) {
  const [location] = useLocation();
  const { role: hrmsRole } = useCurrentHrmsUser();
  const role = (hrmsRole ?? "employee") as Role;

  const groups = useMemo(() => filterNavByRole(role), [role]);

  // Track per-group open state. Auto-open the group containing the active route.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of groups) initial[g.id] = g.defaultOpen ?? false;
    return initial;
  });

  // If the user navigates into a collapsed group, force it open so they can see siblings.
  const effectiveOpen = useMemo(() => {
    const merged = { ...openGroups };
    for (const g of groups) {
      if (g.items.some((i) => location === i.href || location.startsWith(i.href + "/"))) {
        merged[g.id] = true;
      }
    }
    return merged;
  }, [openGroups, groups, location]);

  const toggleGroup = (id: string) =>
    setOpenGroups((s) => ({ ...s, [id]: !(s[id] ?? effectiveOpen[id]) }));

  return (
    <TooltipProvider delayDuration={150}>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 bg-sidebar border-r border-sidebar-border text-sidebar-foreground transition-all duration-200 ease-in-out flex flex-col md:translate-x-0 md:static",
          isOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "w-[72px]" : "w-64",
        )}
        data-testid="app-sidebar"
      >
        {/* Brand row */}
        <div className="h-16 px-3 border-b border-sidebar-border flex items-center justify-between gap-2 shrink-0">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-bold text-sidebar-primary min-w-0"
          >
            <img src={`${BASE}/logo.svg`} alt="MysticsHR" className="w-8 h-8 shrink-0" />
            {!collapsed && <span className="text-lg truncate">MysticsHR</span>}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-sidebar-foreground shrink-0"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1" data-testid="sidebar-nav">
          {groups.map((group) => {
            const open = effectiveOpen[group.id] ?? group.defaultOpen ?? false;
            return (
              <div key={group.id} className="mb-1">
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
                    data-testid={`sidebar-group-${group.id}`}
                    aria-expanded={open}
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 transition-transform",
                        open ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </button>
                )}
                {(collapsed || open) && (
                  <ul className="space-y-0.5 mt-0.5">
                    {group.items.map((item) => {
                      const isActive =
                        location === item.href || location.startsWith(item.href + "/");
                      const Icon = item.icon;
                      const linkClass = cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                        collapsed && "justify-center px-0",
                      );
                      const link = (
                        <Link href={item.href}>
                          <div
                            className={linkClass}
                            onClick={() => setOpen(false)}
                            data-testid={`nav-${item.href.replace(/\//g, "-")}`}
                            aria-current={isActive ? "page" : undefined}
                          >
                            <Icon className="w-5 h-5 shrink-0" />
                            {!collapsed && <span className="truncate">{item.name}</span>}
                          </div>
                        </Link>
                      );
                      return (
                        <li key={item.href}>
                          {collapsed ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{link}</TooltipTrigger>
                              <TooltipContent side="right">{item.name}</TooltipContent>
                            </Tooltip>
                          ) : (
                            link
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <div className="hidden md:flex border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
              collapsed && "justify-center px-0",
            )}
            data-testid="sidebar-collapse-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronsLeft className="w-4 h-4 mr-2" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}

/** Mobile-only menu opener — used by the TopBar. */
export function SidebarMenuButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="md:hidden"
      onClick={onOpen}
      aria-label="Open menu"
      data-testid="sidebar-mobile-toggle"
    >
      <Menu className="w-5 h-5" />
    </Button>
  );
}
