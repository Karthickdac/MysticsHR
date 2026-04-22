import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useListOrgChart, type OrgChartEmployee } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, Search, Users, Network, TrendingUp, FileImage, FileDown, Loader2, Filter, X } from "lucide-react";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";
import { toast } from "sonner";
import { exportOrgChartPng, exportOrgChartPdf } from "./export-utils";

type Node = OrgChartEmployee & { children: Node[] };

function buildTree(employees: OrgChartEmployee[]): { roots: Node[]; orphans: Node[]; cycles: Node[] } {
  const byId = new Map<number, Node>();
  employees.forEach((e) => byId.set(e.id, { ...e, children: [] }));

  const roots: Node[] = [];
  const orphans: Node[] = [];

  byId.forEach((node) => {
    if (node.managerId && byId.has(node.managerId) && node.managerId !== node.id) {
      byId.get(node.managerId)!.children.push(node);
    } else if (!node.managerId) {
      roots.push(node);
    } else {
      // managerId set but the manager isn't in the active list
      orphans.push(node);
    }
  });

  // Detect cycles: any node not reachable from roots/orphans is part of a cycle.
  const reachable = new Set<number>();
  const walk = (n: Node) => {
    if (reachable.has(n.id)) return;
    reachable.add(n.id);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  orphans.forEach(walk);
  const cycles: Node[] = [];
  byId.forEach((n) => {
    if (!reachable.has(n.id)) cycles.push({ ...n, children: [] });
  });

  const sortByName = (a: Node, b: Node) =>
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
  const sortRecursive = (nodes: Node[]) => {
    nodes.sort(sortByName);
    nodes.forEach((n) => sortRecursive(n.children));
  };
  sortRecursive(roots);
  orphans.sort(sortByName);
  cycles.sort(sortByName);

  return { roots, orphans, cycles };
}

function collectIds(nodes: Node[], acc: Set<number> = new Set()): Set<number> {
  nodes.forEach((n) => {
    acc.add(n.id);
    collectIds(n.children, acc);
  });
  return acc;
}

function filterTree(nodes: Node[], q: string): Node[] {
  if (!q) return nodes;
  const lower = q.toLowerCase();
  const matches = (n: Node) =>
    `${n.firstName} ${n.lastName}`.toLowerCase().includes(lower) ||
    (n.designationTitle ?? "").toLowerCase().includes(lower) ||
    (n.departmentName ?? "").toLowerCase().includes(lower);

  const out: Node[] = [];
  nodes.forEach((n) => {
    const childMatches = filterTree(n.children, q);
    if (matches(n) || childMatches.length > 0) {
      out.push({ ...n, children: childMatches });
    }
  });
  return out;
}

function initials(first: string, last: string) {
  return `${(first || "").charAt(0)}${(last || "").charAt(0)}`.toUpperCase() || "U";
}

function NodeCard({
  node,
  expanded,
  onToggle,
  canViewDetail,
  canViewPerformanceHistory,
}: {
  node: Node;
  expanded: boolean;
  onToggle: () => void;
  canViewDetail: boolean;
  canViewPerformanceHistory: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const fullName = `${node.firstName} ${node.lastName}`;
  const cardClick = (e: React.MouseEvent) => {
    if (!hasChildren) return;
    // Don't toggle when clicking the name link or the explicit button.
    const target = e.target as HTMLElement;
    if (target.closest("a, button")) return;
    onToggle();
  };
  return (
    <Card
      className={
        "w-64 border-2 hover:border-primary/40 transition-colors shadow-sm" +
        (hasChildren ? " cursor-pointer" : "")
      }
      onClick={cardClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Avatar className="w-12 h-12 shrink-0">
            {node.avatarUrl ? <AvatarImage src={node.avatarUrl} alt={node.firstName} /> : null}
            <AvatarFallback>{initials(node.firstName, node.lastName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {canViewDetail ? (
              <Link
                href={`/employees/${node.id}`}
                className="block font-semibold text-sm leading-tight truncate hover:underline"
                title={fullName}
              >
                {fullName}
              </Link>
            ) : (
              <div className="block font-semibold text-sm leading-tight truncate" title={fullName}>
                {fullName}
              </div>
            )}
            <div className="text-xs text-muted-foreground truncate" title={node.designationTitle ?? ""}>
              {node.designationTitle ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground truncate" title={node.departmentName ?? ""}>
              {node.departmentName ?? "No department"}
            </div>
            {canViewPerformanceHistory && (
              <Link
                href={`/employees/${node.id}?tab=performance`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                title="View performance history"
                data-testid={`link-performance-history-${node.id}`}
              >
                <TrendingUp className="w-3 h-3" /> Performance History
              </Link>
            )}
          </div>
        </div>
        {hasChildren && (
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              {node.children.length} report{node.children.length === 1 ? "" : "s"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onToggle}
            >
              {expanded ? (
                <>
                  <ChevronDown className="w-3 h-3 mr-1" /> Hide
                </>
              ) : (
                <>
                  <ChevronRight className="w-3 h-3 mr-1" /> Show
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TreeNode({
  node,
  expandedIds,
  toggle,
  canViewDetail,
  canViewPerformanceHistory,
}: {
  node: Node;
  expandedIds: Set<number>;
  toggle: (id: number) => void;
  canViewDetail: boolean;
  canViewPerformanceHistory: boolean;
}) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <li className="relative pl-6 pt-2 first:pt-0">
      {/* Connector lines */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-px bg-border"
      />
      <span
        aria-hidden
        className="absolute left-0 top-7 w-6 h-px bg-border"
      />
      <NodeCard
        node={node}
        expanded={isExpanded}
        onToggle={() => toggle(node.id)}
        canViewDetail={canViewDetail}
        canViewPerformanceHistory={canViewPerformanceHistory}
      />
      {hasChildren && isExpanded && (
        <ul className="mt-1 ml-2 list-none">
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              expandedIds={expandedIds}
              toggle={toggle}
              canViewDetail={canViewDetail}
              canViewPerformanceHistory={canViewPerformanceHistory}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Restrict the employee list to those matching every active filter PLUS all
 * of their ancestors up to the root. Ancestor preservation keeps the chart
 * readable as a hierarchy — a deep IC on a different department still shows
 * the chain of managers above them, so context isn't lost.
 */
function filterEmployeesPreservingAncestors(
  employees: OrgChartEmployee[],
  predicate: (e: OrgChartEmployee) => boolean,
): OrgChartEmployee[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const keep = new Set<number>();
  for (const e of employees) {
    if (!predicate(e)) continue;
    let cur: OrgChartEmployee | undefined = e;
    const seen = new Set<number>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      keep.add(cur.id);
      cur = cur.managerId ? byId.get(cur.managerId) : undefined;
    }
  }
  return employees.filter((e) => keep.has(e.id));
}

type FilterState = {
  departmentIds: Set<number>;
  locations: Set<string>;
  employmentTypes: Set<string>;
};

const EMPTY_FILTERS: FilterState = {
  departmentIds: new Set<number>(),
  locations: new Set<string>(),
  employmentTypes: new Set<string>(),
};

function isFiltersEmpty(f: FilterState): boolean {
  return f.departmentIds.size === 0 && f.locations.size === 0 && f.employmentTypes.size === 0;
}

function parseFiltersFromSearch(search: string): FilterState {
  const sp = new URLSearchParams(search);
  const dept = sp.getAll("dept").flatMap((v) => v.split(",")).filter(Boolean);
  const loc = sp.getAll("loc").flatMap((v) => v.split(",")).filter(Boolean);
  const type = sp.getAll("type").flatMap((v) => v.split(",")).filter(Boolean);
  return {
    departmentIds: new Set(dept.map((d) => Number(d)).filter((n) => Number.isFinite(n))),
    locations: new Set(loc),
    employmentTypes: new Set(type),
  };
}

function serialiseFiltersToSearch(filters: FilterState, otherSearch: string): string {
  const sp = new URLSearchParams(otherSearch);
  sp.delete("dept"); sp.delete("loc"); sp.delete("type");
  if (filters.departmentIds.size) sp.set("dept", [...filters.departmentIds].join(","));
  if (filters.locations.size) sp.set("loc", [...filters.locations].join(","));
  if (filters.employmentTypes.size) sp.set("type", [...filters.employmentTypes].join(","));
  return sp.toString();
}

/** Generic multi-select dropdown using Popover + Command + Checkbox. */
function MultiSelectFilter({
  label, icon, options, selected, onToggle, onClear, testId,
}: {
  label: string;
  icon: React.ReactNode;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const count = selected.size;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid={testId}>
          {icon}
          <span className="ml-1">{label}</span>
          {count > 0 && (
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">{count}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Filter ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const isOn = selected.has(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={o.label}
                    onSelect={() => onToggle(o.value)}
                    className="cursor-pointer"
                  >
                    <Checkbox checked={isOn} className="mr-2 pointer-events-none" />
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {count > 0 && (
            <div className="border-t p-2 flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{count} selected</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClear}>Clear</Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function OrgChartPage() {
  const [search, setSearch] = useState("");

  const { role } = useCurrentHrmsUser();
  const canViewDetail = hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"]);
  const canViewPerformanceHistory = hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod"]);

  // Use the dedicated org-chart endpoint which returns only the safe subset of fields.
  const { data, isLoading } = useListOrgChart();
  const employees = (data?.data ?? []) as OrgChartEmployee[];

  // ─── URL-backed filter state ───────────────────────────────────────────────
  // Filter state lives in the URL so it survives navigation and can be
  // bookmarked / shared. We hydrate from URL on mount and write back via
  // setLocation whenever the user changes filters.
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();
  const [filters, setFilters] = useState<FilterState>(() => parseFiltersFromSearch(urlSearch));

  // Re-hydrate when the URL changes externally (back button etc.)
  useEffect(() => {
    setFilters(parseFiltersFromSearch(urlSearch));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  const updateFilters = useCallback((next: FilterState) => {
    setFilters(next);
    const newSearch = serialiseFiltersToSearch(next, urlSearch);
    // wouter setLocation accepts a path; preserve the current pathname.
    const path = window.location.pathname + (newSearch ? `?${newSearch}` : "");
    setLocation(path, { replace: true });
  }, [setLocation, urlSearch]);

  // ─── Build option lists from the employee data ─────────────────────────────
  const departmentOptions = useMemo(() => {
    const map = new Map<number, string>();
    employees.forEach((e) => {
      if (e.departmentId != null && e.departmentName) map.set(e.departmentId, e.departmentName);
    });
    return [...map.entries()]
      .map(([id, name]) => ({ value: String(id), label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => { if (e.location) set.add(e.location); });
    return [...set].sort().map((l) => ({ value: l, label: l }));
  }, [employees]);

  const employmentTypeOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => { if (e.employmentType) set.add(e.employmentType); });
    return [...set].sort().map((t) => ({ value: t, label: t }));
  }, [employees]);

  // ─── Apply filters with ancestor preservation ──────────────────────────────
  const filteredEmployees = useMemo(() => {
    if (isFiltersEmpty(filters)) return employees;
    const predicate = (e: OrgChartEmployee) => {
      if (filters.departmentIds.size && !(e.departmentId != null && filters.departmentIds.has(e.departmentId))) return false;
      if (filters.locations.size && !(e.location && filters.locations.has(e.location))) return false;
      if (filters.employmentTypes.size && !(e.employmentType && filters.employmentTypes.has(e.employmentType))) return false;
      return true;
    };
    return filterEmployeesPreservingAncestors(employees, predicate);
  }, [employees, filters]);

  // Track which employees actually match the filter (vs. just kept as ancestor
  // context) so we can show an accurate count in the summary.
  const directMatchCount = useMemo(() => {
    if (isFiltersEmpty(filters)) return employees.length;
    return employees.filter((e) => {
      if (filters.departmentIds.size && !(e.departmentId != null && filters.departmentIds.has(e.departmentId))) return false;
      if (filters.locations.size && !(e.location && filters.locations.has(e.location))) return false;
      if (filters.employmentTypes.size && !(e.employmentType && filters.employmentTypes.has(e.employmentType))) return false;
      return true;
    }).length;
  }, [employees, filters]);

  const { roots, orphans, cycles } = useMemo(() => buildTree(filteredEmployees), [filteredEmployees]);

  // By default, expand the top two levels so users see structure without clicking.
  const defaultExpanded = useMemo(() => {
    const ids = new Set<number>();
    roots.forEach((r) => {
      ids.add(r.id);
      r.children.forEach((c) => ids.add(c.id));
    });
    return ids;
  }, [roots]);

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  // Re-seed the default expansion when the employee set changes.
  useEffect(() => {
    setExpandedIds(new Set(defaultExpanded));
  }, [defaultExpanded]);

  const toggle = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredRoots = useMemo(() => filterTree(roots, search.trim()), [roots, search]);
  const filteredOrphans = useMemo(() => filterTree(orphans, search.trim()), [orphans, search]);
  const filteredCycles = useMemo(() => filterTree(cycles, search.trim()), [cycles, search]);

  // When searching OR when filters are active, force-expand all matching subtrees
  // so users can see the chain context (ancestors) and matched leaves at once.
  const effectiveExpanded = useMemo(() => {
    if (!search.trim() && isFiltersEmpty(filters)) return expandedIds;
    return collectIds([...filteredRoots, ...filteredOrphans, ...filteredCycles]);
  }, [search, expandedIds, filteredRoots, filteredOrphans, filteredCycles, filters]);

  const expandAll = () => setExpandedIds(collectIds([...roots, ...orphans, ...cycles]));
  const collapseAll = () => setExpandedIds(new Set());

  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);

  const filterScopeLabel = !isFiltersEmpty(filters) ? "filtered" : "";
  const searchScopeLabel = search.trim() ? `search-${search.trim()}` : "";
  const exportScope = [searchScopeLabel, filterScopeLabel].filter(Boolean).join("-") || "all";
  const canExport =
    !isLoading &&
    (filteredRoots.length + filteredOrphans.length + filteredCycles.length) > 0;

  const runExport = async (kind: "png" | "pdf") => {
    if (!chartRef.current || exporting) return;
    setExporting(kind);
    try {
      // Wait for the export footer (rendered conditionally on `exporting`)
      // to commit to the DOM before we snapshot.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (kind === "png") {
        await exportOrgChartPng(chartRef.current, exportScope);
      } else {
        await exportOrgChartPdf(chartRef.current, exportScope);
      }
      toast.success(kind === "png" ? "Org chart PNG downloaded" : "Org chart PDF downloaded");
    } catch (err) {
      console.error("[org-chart export]", err);
      toast.error(`Failed to export org chart as ${kind.toUpperCase()}`);
    } finally {
      setExporting(null);
    }
  };

  const exportDateLabel = useMemo(
    () => new Date().toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" }),
    [exporting], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Organization Chart
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live reporting structure across {employees.length} employee{employees.length === 1 ? "" : "s"}.
            {!isFiltersEmpty(filters) && (
              <span className="ml-1">
                — showing {directMatchCount} match{directMatchCount === 1 ? "" : "es"} (with reporting chain).
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search name, role, dept…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-64"
              data-testid="input-org-chart-search"
            />
          </div>
          <MultiSelectFilter
            label="Department"
            icon={<Filter className="w-3.5 h-3.5" />}
            options={departmentOptions}
            selected={new Set([...filters.departmentIds].map(String))}
            onToggle={(v) => {
              const id = Number(v);
              const next = new Set(filters.departmentIds);
              if (next.has(id)) next.delete(id); else next.add(id);
              updateFilters({ ...filters, departmentIds: next });
            }}
            onClear={() => updateFilters({ ...filters, departmentIds: new Set() })}
            testId="filter-department"
          />
          <MultiSelectFilter
            label="Location"
            icon={<Filter className="w-3.5 h-3.5" />}
            options={locationOptions}
            selected={filters.locations}
            onToggle={(v) => {
              const next = new Set(filters.locations);
              if (next.has(v)) next.delete(v); else next.add(v);
              updateFilters({ ...filters, locations: next });
            }}
            onClear={() => updateFilters({ ...filters, locations: new Set() })}
            testId="filter-location"
          />
          <MultiSelectFilter
            label="Type"
            icon={<Filter className="w-3.5 h-3.5" />}
            options={employmentTypeOptions}
            selected={filters.employmentTypes}
            onToggle={(v) => {
              const next = new Set(filters.employmentTypes);
              if (next.has(v)) next.delete(v); else next.add(v);
              updateFilters({ ...filters, employmentTypes: next });
            }}
            onClear={() => updateFilters({ ...filters, employmentTypes: new Set() })}
            testId="filter-employment-type"
          />
          <Button variant="outline" size="sm" onClick={expandAll}>
            Expand all
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Collapse all
          </Button>
          <Button
            variant="outline" size="sm"
            disabled={!canExport || exporting !== null}
            onClick={() => runExport("png")}
            data-testid="button-export-org-chart-png"
            title="Download the current org chart as a PNG image"
          >
            {exporting === "png" ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <FileImage className="w-4 h-4 mr-1" />
            )}
            Export PNG
          </Button>
          <Button
            variant="outline" size="sm"
            disabled={!canExport || exporting !== null}
            onClick={() => runExport("pdf")}
            data-testid="button-export-org-chart-pdf"
            title="Download the current org chart as a paginated PDF"
          >
            {exporting === "pdf" ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-1" />
            )}
            Export PDF
          </Button>
        </div>
      </div>

      {/* Active filter chips — render only when at least one filter is set. */}
      {!isFiltersEmpty(filters) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="org-chart-filter-chips">
          {[...filters.departmentIds].map((id) => {
            const opt = departmentOptions.find((o) => o.value === String(id));
            if (!opt) return null;
            return (
              <Badge key={`d-${id}`} variant="secondary" className="gap-1 pr-1">
                <span>Dept: {opt.label}</span>
                <button
                  type="button"
                  className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
                  onClick={() => {
                    const next = new Set(filters.departmentIds);
                    next.delete(id);
                    updateFilters({ ...filters, departmentIds: next });
                  }}
                  aria-label={`Remove ${opt.label} filter`}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            );
          })}
          {[...filters.locations].map((loc) => (
            <Badge key={`l-${loc}`} variant="secondary" className="gap-1 pr-1">
              <span>Location: {loc}</span>
              <button
                type="button"
                className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
                onClick={() => {
                  const next = new Set(filters.locations);
                  next.delete(loc);
                  updateFilters({ ...filters, locations: next });
                }}
                aria-label={`Remove ${loc} filter`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          {[...filters.employmentTypes].map((t) => (
            <Badge key={`t-${t}`} variant="secondary" className="gap-1 pr-1">
              <span>Type: {t}</span>
              <button
                type="button"
                className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
                onClick={() => {
                  const next = new Set(filters.employmentTypes);
                  next.delete(t);
                  updateFilters({ ...filters, employmentTypes: next });
                }}
                aria-label={`Remove ${t} filter`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => updateFilters(EMPTY_FILTERS)}
            data-testid="button-clear-org-chart-filters"
          >
            Clear all
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading org chart…</div>
      ) : roots.length === 0 && orphans.length === 0 && cycles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No employees yet — add employees and set their reporting manager to see the org chart.
          </CardContent>
        </Card>
      ) : filteredRoots.length === 0 && filteredOrphans.length === 0 && filteredCycles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No matches for "{search}".
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div ref={chartRef} className="bg-background p-4 min-w-fit inline-block">
          <ul className="list-none space-y-4 min-w-fit">
            {filteredRoots.map((r) => (
              <TreeNode
                key={r.id}
                node={r}
                expandedIds={effectiveExpanded}
                toggle={toggle}
                canViewDetail={canViewDetail}
                canViewPerformanceHistory={canViewPerformanceHistory}
              />
            ))}
          </ul>

          {filteredOrphans.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Without a listed manager
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Employees whose manager record isn't visible in this list (e.g. inactive or out-of-scope).
              </p>
              <ul className="list-none space-y-4 min-w-fit">
                {filteredOrphans.map((o) => (
                  <TreeNode
                    key={o.id}
                    node={o}
                    expandedIds={effectiveExpanded}
                    toggle={toggle}
                    canViewDetail={canViewDetail}
                    canViewPerformanceHistory={canViewPerformanceHistory}
                  />
                ))}
              </ul>
            </div>
          )}

          {filteredCycles.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-amber-700 mb-2 uppercase tracking-wide">
                Invalid reporting relationships
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                These employees are part of a reporting cycle (e.g. A reports to B, B reports to A). HR should review and fix the manager assignments.
              </p>
              <ul className="list-none space-y-4 min-w-fit">
                {filteredCycles.map((c) => (
                  <TreeNode
                    key={c.id}
                    node={c}
                    expandedIds={effectiveExpanded}
                    toggle={toggle}
                    canViewDetail={canViewDetail}
                    canViewPerformanceHistory={canViewPerformanceHistory}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* Export-only footer rendered into the snapshot region for PNG
              exports. PDF exports get an equivalent footer drawn directly
              by pdf-lib (with page numbers) so we skip the in-DOM footer
              there to avoid duplicate footer content. */}
          {exporting === "png" && (
            <div
              data-testid="org-chart-export-footer"
              className="mt-6 pt-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between"
            >
              <span>Automystics Technologies — Organization Chart</span>
              <span>Exported on {exportDateLabel}</span>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
