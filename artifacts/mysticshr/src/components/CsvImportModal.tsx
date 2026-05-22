import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileDown, CheckCircle2, AlertCircle, X } from "lucide-react";
import { extractError } from "@/lib/utils";

export type CsvColumn = {
  key: string;
  label: string;
  required?: boolean;
  example?: string;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  errors: { row: number; error: string }[];
};

type PreviewRow = {
  data: Record<string, string>;
  errors: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  templateFileName: string;
  columns: CsvColumn[];
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>;
  onImported?: () => void;
};

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Minimal RFC-4180-ish parser supporting quoted fields and embedded commas/newlines.
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.length > 1 || cur[0] !== "") rows.push(cur);
        cur = [];
      } else { field += c; }
    }
  }
  if (field !== "" || cur.length > 0) { cur.push(field); rows.push(cur); }
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

function buildTemplate(columns: CsvColumn[]): string {
  const headerLine = columns.map((c) => c.key).join(",");
  const exampleLine = columns
    .map((c) => {
      const v = c.example ?? "";
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(",");
  return `${headerLine}\n${exampleLine}\n`;
}

export function CsvImportModal({ open, onOpenChange, title, templateFileName, columns, onImport, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setParseError(null);
    setResult(null);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplate(columns)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateFileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(f: File | null) {
    setFile(f);
    setResult(null);
    setParseError(null);
    setPreview(null);
    if (!f) return;
    try {
      const text = await f.text();
      const { headers, rows } = parseCsv(text);
      if (headers.length === 0) { setParseError("CSV appears to be empty."); return; }
      const requiredKeys = columns.filter((c) => c.required).map((c) => c.key);
      const missingRequired = requiredKeys.filter((k) => !headers.includes(k));
      if (missingRequired.length > 0) {
        setParseError(`Missing required column(s): ${missingRequired.join(", ")}. Download the template to see the correct format.`);
        return;
      }
      const previewRows: PreviewRow[] = rows.map((vals) => {
        const data: Record<string, string> = {};
        headers.forEach((h, i) => { data[h] = (vals[i] ?? "").trim(); });
        const errs: string[] = [];
        for (const col of columns) {
          if (col.required && !data[col.key]) errs.push(`${col.label} is required`);
        }
        return { data, errors: errs };
      });
      setPreview(previewRows);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Failed to parse CSV");
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    const validRows = preview.filter((p) => p.errors.length === 0).map((p) => p.data);
    if (validRows.length === 0) {
      setParseError("No valid rows to import. Fix the errors above and try again.");
      return;
    }
    setImporting(true);
    try {
      const r = await onImport(validRows);
      setResult(r);
      onImported?.();
    } catch (err: unknown) {
      setParseError(extractError(err, err instanceof Error ? err.message : "Import failed"));
    } finally {
      setImporting(false);
    }
  }

  const validCount = preview?.filter((p) => p.errors.length === 0).length ?? 0;
  const invalidCount = preview?.filter((p) => p.errors.length > 0).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Download the template, fill it in, then upload to preview and import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <FileDown className="w-4 h-4 mr-2" />Download Template
            </Button>
            {(file || preview || result) && (
              <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
            )}
          </div>

          {!file && (
            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f && f.name.toLowerCase().endsWith(".csv")) handleFile(f);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Drop your CSV here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Only .csv files are accepted</p>
            </div>
          )}

          {file && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
              <span className="text-sm font-medium">{file.name}</span>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => handleFile(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {parseError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{parseError}</p>
            </div>
          )}

          {preview && !result && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">{preview.length} rows parsed</span>
                <span className="text-green-700">· {validCount} valid</span>
                {invalidCount > 0 && <span className="text-destructive">· {invalidCount} with errors</span>}
              </div>
              <div className="border border-border rounded-lg overflow-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      {columns.map((c) => (
                        <th key={c.key} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                          {c.label}{c.required && <span className="text-destructive ml-0.5">*</span>}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, idx) => (
                      <tr key={idx} className={row.errors.length > 0 ? "bg-destructive/5" : ""}>
                        <td className="px-2 py-1.5 text-muted-foreground">{idx + 1}</td>
                        {columns.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 whitespace-nowrap">
                            {row.data[c.key] || <span className="text-muted-foreground italic">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1.5">
                          {row.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-green-700">
                              <CheckCircle2 className="w-3 h-3" />Valid
                            </span>
                          ) : (
                            <span className="text-destructive">{row.errors.join("; ")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">{result.imported} records imported</span>
              </div>
              {result.skipped > 0 && (
                <p className="text-xs text-muted-foreground">{result.skipped} row(s) skipped due to errors</p>
              )}
              {result.errors.length > 0 && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>Row {e.row}: {e.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={handleConfirm} disabled={!preview || validCount === 0 || importing}>
              {importing ? "Importing…" : `Import ${validCount} row(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
