import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { Bell, LogOut, Search, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { resolveActiveItem } from "./nav-config";
import { SidebarMenuButton } from "./Sidebar";

interface TopBarProps {
  onMobileMenuOpen: () => void;
  onCommandOpen: () => void;
}

const formatRole = (r: string) =>
  r.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

export function TopBar({ onMobileMenuOpen, onCommandOpen }: TopBarProps) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { hrmsUser, role: hrmsRole } = useCurrentHrmsUser();

  const role = hrmsRole ?? "employee";
  const active = resolveActiveItem(location);

  // Build breadcrumb segments after the resolved module.
  const trailingSegments = (() => {
    if (!active) return [];
    const tail = location.slice(active.href.length).replace(/^\/+|\/+$/g, "");
    if (!tail) return [];
    return tail.split("/").map((seg, i, arr) => ({
      label: prettify(seg),
      href: active.href + "/" + arr.slice(0, i + 1).join("/"),
      isLast: i === arr.length - 1,
    }));
  })();

  const displayName = hrmsUser?.name || user?.fullName || user?.primaryEmailAddress?.emailAddress || "User";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header
      className="h-16 border-b border-border bg-background flex items-center gap-2 px-3 md:px-6 shrink-0"
      data-testid="app-topbar"
    >
      <SidebarMenuButton onOpen={onMobileMenuOpen} />

      {/* Breadcrumbs */}
      <div className="hidden md:flex items-center min-w-0 flex-1">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/dashboard">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {active && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {trailingSegments.length === 0 ? (
                    <BreadcrumbPage>{active.name}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={active.href}>{active.name}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </>
            )}
            {trailingSegments.map((s) => (
              <span key={s.href} className="contents">
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {s.isLast ? (
                    <BreadcrumbPage>{s.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={s.href}>{s.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Mobile title fallback */}
      <div className="flex-1 md:hidden font-semibold text-base truncate">
        {active?.name ?? "MysticsHR"}
      </div>

      {/* Search trigger */}
      <Button
        variant="outline"
        size="sm"
        className="hidden sm:inline-flex items-center gap-2 text-muted-foreground h-9 px-3 min-w-[200px] justify-between"
        onClick={onCommandOpen}
        data-testid="topbar-search-trigger"
        aria-label="Search modules and pages"
      >
        <span className="flex items-center gap-2">
          <Search className="w-4 h-4" />
          <span className="text-xs">Search…</span>
        </span>
        <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono">
          {isMac ? "⌘" : "Ctrl"}K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        onClick={onCommandOpen}
        aria-label="Search"
      >
        <Search className="w-5 h-5" />
      </Button>

      {/* Notifications (placeholder bell — links to communications) */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setLocation("/communications")}
        aria-label="Notifications"
        data-testid="topbar-notifications"
      >
        <Bell className="w-5 h-5" />
      </Button>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-10 px-2 gap-2 hover:bg-muted"
            data-testid="topbar-user-menu"
            aria-label="User menu"
          >
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center overflow-hidden">
              {user?.imageUrl ? (
                <img src={user.imageUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div className="hidden lg:flex flex-col items-start min-w-0 max-w-[160px]">
              <span className="text-sm font-medium leading-tight truncate w-full text-left">
                {displayName}
              </span>
              <span className="text-[11px] text-muted-foreground leading-tight truncate w-full text-left">
                {formatRole(role)}
              </span>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium truncate">{displayName}</span>
              <span className="text-xs text-muted-foreground font-normal truncate">
                {formatRole(role)}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setLocation("/ess")} data-testid="user-menu-profile">
            <UserIcon className="w-4 h-4 mr-2" />
            My Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocation("/communications")}>
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => signOut(() => setLocation("/"))}
            data-testid="user-menu-signout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function prettify(seg: string): string {
  // UUIDs and numeric IDs get rendered as "Details", everything else is title-cased.
  if (/^[0-9a-f]{8}-/i.test(seg) || /^\d+$/.test(seg)) return "Details";
  return seg
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
