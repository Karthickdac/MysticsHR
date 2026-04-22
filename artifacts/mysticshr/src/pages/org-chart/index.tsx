import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useListOrgChart, type OrgChartEmployee } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search, Users, Network, TrendingUp, FileImage, FileDown, Loader2 } from "lucide-react";
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

export default function OrgChartPage() {
  const [search, setSearch] = useState("");

  const { role } = useCurrentHrmsUser();
  const canViewDetail = hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin"]);
  const canViewPerformanceHistory = hasRole(role, ["super_admin", "hr_manager", "hr_executive", "hod"]);

  // Use the dedicated org-chart endpoint which returns only the safe subset of fields.
  const { data, isLoading } = useListOrgChart();
  const employees = (data?.data ?? []) as OrgChartEmployee[];

  const { roots, orphans, cycles } = useMemo(() => buildTree(employees), [employees]);

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

  // When searching, force-expand all matching subtrees
  const effectiveExpanded = useMemo(() => {
    if (!search.trim()) return expandedIds;
    return collectIds([...filteredRoots, ...filteredOrphans, ...filteredCycles]);
  }, [search, expandedIds, filteredRoots, filteredOrphans, filteredCycles]);

  const expandAll = () => setExpandedIds(collectIds([...roots, ...orphans, ...cycles]));
  const collapseAll = () => setExpandedIds(new Set());

  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);

  const exportScope = search.trim() ? `search-${search.trim()}` : "all";
  const canExport =
    !isLoading &&
    (filteredRoots.length + filteredOrphans.length + filteredCycles.length) > 0;

  const runExport = async (kind: "png" | "pdf") => {
    if (!chartRef.current || exporting) return;
    setExporting(kind);
    try {
      // Force-expand everything in the rendered DOM before snapshotting so
      // the export reflects the full visible structure, not just the user's
      // current click-state. We then restore the prior expansion below.
      const previousExpanded = expandedIds;
      setExpandedIds(collectIds([...roots, ...orphans, ...cycles]));
      // Wait one paint so React commits the expansion before capture.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      try {
        if (kind === "png") {
          await exportOrgChartPng(chartRef.current, exportScope);
        } else {
          await exportOrgChartPdf(chartRef.current, exportScope);
        }
        toast.success(kind === "png" ? "Org chart PNG downloaded" : "Org chart PDF downloaded");
      } finally {
        // Restore prior expansion regardless of success/failure.
        setExpandedIds(previousExpanded);
      }
    } catch (err) {
      console.error("[org-chart export]", err);
      toast.error(`Failed to export org chart as ${kind.toUpperCase()}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Organization Chart
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live reporting structure across {employees.length} employee{employees.length === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search name, role, dept…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
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
          </div>
        </div>
      )}
    </div>
  );
}
