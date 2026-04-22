import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { filterNavByRole, type Role } from "./nav-config";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, setLocation] = useLocation();
  const { role: hrmsRole } = useCurrentHrmsUser();
  const role = (hrmsRole ?? "employee") as Role;

  const groups = useMemo(() => filterNavByRole(role), [role]);

  // Global ⌘/Ctrl+K shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const go = (href: string) => {
    setLocation(href);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search modules, pages, actions…" data-testid="command-input" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.map((item) => {
              const Icon = item.icon;
              const value = `${item.name} ${group.label} ${(item.keywords ?? []).join(" ")}`;
              return (
                <CommandItem
                  key={item.href}
                  value={value}
                  onSelect={() => go(item.href)}
                  data-testid={`command-${item.href.replace(/\//g, "-")}`}
                >
                  <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
                  <span>{item.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/70">
                    {item.href}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
