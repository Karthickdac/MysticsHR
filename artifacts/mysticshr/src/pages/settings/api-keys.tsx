import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Copy, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const SCOPES: { id: string; label: string; hint: string }[] = [
  { id: "employees:read", label: "employees:read", hint: "Read employee profiles" },
  { id: "departments:read", label: "departments:read", hint: "Read departments" },
  { id: "attendance:read", label: "attendance:read", hint: "Read attendance records" },
  { id: "payslips:read", label: "payslips:read", hint: "Read generated payslips" },
  { id: "leave:read", label: "leave:read", hint: "Read leave balances" },
];

interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/api-keys`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setKeys(j.data ?? []);
    } catch (err: any) {
      toast({ title: "Failed to load API keys", description: String(err.message ?? err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function toggleScope(id: string, checked: boolean) {
    setScopes((cur) => checked ? [...cur, id] : cur.filter((s) => s !== id));
  }

  function resetCreateForm() {
    setName("");
    setScopes([]);
    setExpiresAt("");
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (scopes.length === 0) {
      toast({ title: "Pick at least one scope", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const r = await fetch(`${BASE_URL}/api/api-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Create failed");
      setCreatedKey(j.key);
      setOpenCreate(false);
      resetCreateForm();
      void load();
    } catch (err: any) {
      toast({ title: "Failed to create key", description: String(err.message ?? err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(row: ApiKeyRow) {
    if (!confirm(`Revoke key "${row.name}"? Calls using this key will start failing immediately.`)) return;
    try {
      const r = await fetch(`${BASE_URL}/api/api-keys/${row.id}/revoke`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Key revoked" });
      void load();
    } catch (err: any) {
      toast({ title: "Failed to revoke", description: String(err.message ?? err), variant: "destructive" });
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "Copied to clipboard" }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  }

  function statusBadge(row: ApiKeyRow) {
    if (row.revokedAt) return <Badge variant="destructive">Revoked</Badge>;
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
      return <Badge variant="secondary">Expired</Badge>;
    }
    return <Badge>Active</Badge>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <KeyRound className="h-6 w-6" /> API Keys
          </h1>
          <p className="text-sm text-muted-foreground">
            Issue keys for external apps to read MysticsHR data via{" "}
            <a className="underline" href={`${BASE_URL}/api/docs`} target="_blank" rel="noreferrer">
              the public API
            </a>.
          </p>
        </div>
        <Button onClick={() => setOpenCreate(true)} data-testid="button-new-api-key">
          <Plus className="h-4 w-4 mr-2" /> New API Key
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Existing keys</CardTitle>
          <CardDescription>
            We only store a hash of each key. If you lose a secret you must revoke it and create a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell><code className="text-xs">mhr_live_{k.prefix}_…</code></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(k)}</TableCell>
                    <TableCell className="text-xs">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(k.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {!k.revokedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRevoke(k)}
                          data-testid={`button-revoke-${k.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={openCreate} onOpenChange={(o) => { setOpenCreate(o); if (!o) resetCreateForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API Key</DialogTitle>
            <DialogDescription>
              The full secret will be shown only once. Copy it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                placeholder="e.g. Slack notifier"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-api-key-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="space-y-2">
                {SCOPES.map((s) => (
                  <label key={s.id} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={scopes.includes(s.id)}
                      onCheckedChange={(c) => toggleScope(s.id, c === true)}
                      data-testid={`checkbox-scope-${s.id}`}
                    />
                    <span>
                      <code className="font-mono text-xs">{s.label}</code>
                      <span className="text-muted-foreground"> — {s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key-expires">Expires at (optional)</Label>
              <Input
                id="api-key-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                data-testid="input-api-key-expires"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating} data-testid="button-create-api-key">
              {creating ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "Show secret once" dialog */}
      <Dialog open={createdKey !== null} onOpenChange={(o) => { if (!o) setCreatedKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" /> Copy your new key now
            </DialogTitle>
            <DialogDescription>
              This is the only time the full secret will be displayed. Store it in your secrets manager.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3">
            <code className="break-all text-xs">{createdKey}</code>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => createdKey && copyToClipboard(createdKey)}>
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
            <Button onClick={() => setCreatedKey(null)}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
