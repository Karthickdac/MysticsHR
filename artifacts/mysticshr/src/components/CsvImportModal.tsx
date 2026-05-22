import { useRef, useState } from "react";
import JSZip from "jszip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileDown, CheckCircle2, AlertCircle, X, Paperclip } from "lucide-react";
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

export type FileMatchConfig = {
  // CSV column whose value is treated as a filename to match against the
  // companion zip. After upload, the column is overwritten with the URL
  // returned by `onUploadFile`.
  column: string;
  helpText?: string;
};

type PreviewRow = {
  data: Record<string, string>;
  errors: string[];
  // Filled when fileMatch is active: undefined = no filename in row, null = no
  // zip loaded or no match, otherwise the matched zip entry.
  match?: ZipEntry | null;
  // Human-readable reason the matched file can't be uploaded (oversized or
  // disallowed type). Row still imports, but the file column is cleared.
  fileError?: string;
};

// Keep these in sync with artifacts/api-server/src/routes/storage.ts.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIMES = new Set<string>([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function validateZipEntry(entry: ZipEntry): string | undefined {
  if (entry.size > MAX_UPLOAD_BYTES) {
    return `${entry.name} is ${formatBytes(entry.size)}, max is ${formatBytes(MAX_UPLOAD_BYTES)}`;
  }
  const mime = guessMime(entry.name);
  if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
    return `${entry.name} has an unsupported file type (${mime || "unknown"})`;
  }
  return undefined;
}

type ZipEntry = {
  name: string; // basename used for matching
  fullPath: string; // path inside the zip
  size: number;
  load: () => Promise<File>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  templateFileName: string;
  columns: CsvColumn[];
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>;
  onImported?: () => void;
  fileMatch?: FileMatchConfig;
  onUploadFile?: (file: File) => Promise<string>;
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

function basename(p: string): string {
  const cleaned = p.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

function recomputeMatches(
  rows: PreviewRow[],
  fileMatch: FileMatchConfig | undefined,
  entriesByName: Map<string, ZipEntry> | null,
): PreviewRow[] {
  if (!fileMatch) return rows;
  return rows.map((r) => {
    const raw = (r.data[fileMatch.column] ?? "").trim();
    if (!raw || isHttpUrl(raw)) return { ...r, match: undefined, fileError: undefined };
    const lookup = basename(raw).toLowerCase();
    const match = entriesByName?.get(lookup) ?? null;
    const fileError = match ? validateZipEntry(match) : undefined;
    return { ...r, match, fileError };
  });
}

export function CsvImportModal({
  open, onOpenChange, title, templateFileName, columns, onImport, onImported,
  fileMatch, onUploadFile,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipEntries, setZipEntries] = useState<Map<string, ZipEntry> | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setParseError(null);
    setResult(null);
    setImporting(false);
    setUploadProgress(null);
    setZipFile(null);
    setZipEntries(null);
    setZipError(null);
    if (fileRef.current) fileRef.current.value = "";
    if (zipRef.current) zipRef.current.value = "";
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
      setPreview(recomputeMatches(previewRows, fileMatch, zipEntries));
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Failed to parse CSV");
    }
  }

  async function handleZip(f: File | null) {
    setZipError(null);
    setZipFile(f);
    if (!f) {
      setZipEntries(null);
      if (preview) setPreview(recomputeMatches(preview, fileMatch, null));
      return;
    }
    try {
      const zip = await JSZip.loadAsync(f);
      const map = new Map<string, ZipEntry>();
      const collisions: string[] = [];
      zip.forEach((relativePath, entry) => {
        if (entry.dir) return;
        const name = basename(relativePath);
        if (!name || name.startsWith(".")) return;
        const key = name.toLowerCase();
        const e: ZipEntry = {
          name,
          fullPath: relativePath,
          // _data is JSZip's internal sizing — fall back to 0 if unavailable.
          size: ((entry as unknown) as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
          load: async () => {
            const blob = await entry.async("blob");
            // Best-effort MIME from the original filename, since zips strip it.
            return new File([blob], name, { type: blob.type || guessMime(name) });
          },
        };
        if (map.has(key)) collisions.push(name);
        map.set(key, e);
      });
      setZipEntries(map);
      if (collisions.length > 0) {
        setZipError(`${collisions.length} filename(s) appear more than once in the zip (only the last is used): ${collisions.slice(0, 3).join(", ")}${collisions.length > 3 ? "…" : ""}`);
      }
      if (preview) setPreview(recomputeMatches(preview, fileMatch, map));
    } catch (err: unknown) {
      setZipError(err instanceof Error ? `Could not read zip: ${err.message}` : "Could not read zip");
      setZipEntries(null);
      if (preview) setPreview(recomputeMatches(preview, fileMatch, null));
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    const validRows = preview.filter((p) => p.errors.length === 0);
    if (validRows.length === 0) {
      setParseError("No valid rows to import. Fix the errors above and try again.");
      return;
    }
    setImporting(true);
    setParseError(null);
    try {
      // Upload matched files first so each row's URL column is populated
      // before the CSV is posted to the server. Failures fall back to
      // clearing the column and surface as warnings via the import result.
      const toUpload = fileMatch && onUploadFile
        ? validRows.filter((r) => r.match && !r.fileError)
        : [];
      // Surface pre-validation failures (oversized / disallowed MIME) as
      // skipped-file warnings so the row still imports without a file URL
      // instead of failing the network call mid-batch.
      const preSkipped: { row: number; error: string }[] = [];
      if (fileMatch && onUploadFile) {
        for (const r of validRows) {
          if (r.match && r.fileError) {
            preSkipped.push({ row: preview.indexOf(r) + 1, error: `Skipped file: ${r.fileError}` });
          }
        }
      }
      const uploadErrors: { row: number; error: string }[] = [];
      const urls = new Map<PreviewRow, string | null>();
      if (toUpload.length > 0 && fileMatch && onUploadFile) {
        setUploadProgress({ done: 0, total: toUpload.length });
        for (let i = 0; i < toUpload.length; i++) {
          const row = toUpload[i];
          try {
            const f = await row.match!.load();
            const url = await onUploadFile(f);
            urls.set(row, url);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Upload failed";
            uploadErrors.push({ row: preview.indexOf(row) + 1, error: `File upload failed: ${msg}` });
            urls.set(row, null);
          }
          setUploadProgress({ done: i + 1, total: toUpload.length });
        }
      }
      // Unified payload construction: substitute upload URLs when present and
      // always clear the file column for pre-skipped (oversized/disallowed)
      // rows, even when no uploads ran at all.
      const payloadRows: Record<string, string>[] = validRows.map((r) => {
        const data = { ...r.data };
        if (fileMatch) {
          if (urls.has(r)) {
            const url = urls.get(r);
            if (url) data[fileMatch.column] = url;
            else delete data[fileMatch.column];
          } else if (r.fileError) {
            delete data[fileMatch.column];
          }
        }
        return data;
      });
      const r = await onImport(payloadRows);
      setResult({
        ...r,
        skipped: r.skipped + uploadErrors.length + preSkipped.length,
        errors: [...preSkipped, ...uploadErrors, ...r.errors],
      });
      onImported?.();
    } catch (err: unknown) {
      setParseError(extractError(err, err instanceof Error ? err.message : "Import failed"));
    } finally {
      setImporting(false);
      setUploadProgress(null);
    }
  }

  const validCount = preview?.filter((p) => p.errors.length === 0).length ?? 0;
  const invalidCount = preview?.filter((p) => p.errors.length > 0).length ?? 0;

  // File-match summary: count rows that name a file vs files matched vs
  // unused entries in the zip, so HR can see at a glance whether their
  // folder lines up with the CSV.
  let matchSummary: { wanted: number; matched: number; unmatchedRows: string[]; unusedFiles: string[]; skipped: string[] } | null = null;
  if (fileMatch && preview) {
    const wantedRows = preview.filter((r) => {
      const v = (r.data[fileMatch.column] ?? "").trim();
      return v && !isHttpUrl(v);
    });
    const matchedRows = wantedRows.filter((r) => r.match);
    const unmatchedRows = wantedRows
      .filter((r) => !r.match)
      .map((r) => (r.data[fileMatch.column] ?? "").trim());
    const usedKeys = new Set(matchedRows.map((r) => r.match!.name.toLowerCase()));
    const unusedFiles = zipEntries
      ? Array.from(zipEntries.values()).filter((e) => !usedKeys.has(e.name.toLowerCase())).map((e) => e.fullPath)
      : [];
    const skipped = matchedRows
      .filter((r) => r.fileError)
      .map((r) => r.fileError!);
    matchSummary = {
      wanted: wantedRows.length,
      matched: matchedRows.length,
      unmatchedRows,
      unusedFiles,
      skipped,
    };
  }

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

          {file && fileMatch && onUploadFile && !result && (
            <div className="space-y-2">
              {!zipFile && (
                <div
                  className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  onClick={() => zipRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f && f.name.toLowerCase().endsWith(".zip")) handleZip(f);
                  }}
                >
                  <input
                    ref={zipRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(e) => handleZip(e.target.files?.[0] ?? null)}
                  />
                  <Paperclip className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-sm font-medium">Optional: drop a zip of files</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fileMatch.helpText ?? `Files matched by the "${fileMatch.column}" column will be uploaded and linked automatically.`}
                  </p>
                </div>
              )}
              {zipFile && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <span className="text-sm font-medium truncate">
                    <Paperclip className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    {zipFile.name}
                    {zipEntries && <span className="text-muted-foreground"> · {zipEntries.size} file(s)</span>}
                  </span>
                  <button className="text-muted-foreground hover:text-destructive" onClick={() => handleZip(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              {zipError && (
                <p className="text-xs text-amber-700">{zipError}</p>
              )}
            </div>
          )}

          {parseError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{parseError}</p>
            </div>
          )}

          {matchSummary && (matchSummary.wanted > 0 || (zipEntries && zipEntries.size > 0)) && !result && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs space-y-1">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-medium">Files:</span>
                <span>{matchSummary.matched}/{matchSummary.wanted} matched</span>
                {!zipFile && matchSummary.wanted > 0 && (
                  <span className="text-amber-700">drop a zip above to upload them</span>
                )}
              </div>
              {matchSummary.unmatchedRows.length > 0 && zipFile && (
                <p className="text-amber-700">
                  Not found in zip: {matchSummary.unmatchedRows.slice(0, 5).join(", ")}
                  {matchSummary.unmatchedRows.length > 5 ? `, +${matchSummary.unmatchedRows.length - 5} more` : ""}
                </p>
              )}
              {matchSummary.skipped.length > 0 && (
                <p className="text-amber-700">
                  {matchSummary.skipped.length} file(s) will be skipped (row still imports without a file URL):
                  {" "}{matchSummary.skipped.slice(0, 3).join("; ")}
                  {matchSummary.skipped.length > 3 ? `; +${matchSummary.skipped.length - 3} more` : ""}
                </p>
              )}
              {matchSummary.unusedFiles.length > 0 && (
                <p className="text-amber-700">
                  Unused files in zip: {matchSummary.unusedFiles.slice(0, 5).join(", ")}
                  {matchSummary.unusedFiles.length > 5 ? `, +${matchSummary.unusedFiles.length - 5} more` : ""}
                </p>
              )}
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
                        {columns.map((c) => {
                          const isMatchCol = fileMatch?.column === c.key;
                          const cellValue = row.data[c.key];
                          return (
                            <td key={c.key} className="px-2 py-1.5 whitespace-nowrap">
                              {cellValue || <span className="text-muted-foreground italic">—</span>}
                              {isMatchCol && row.match && !row.fileError && (
                                <span className="ml-1.5 text-[10px] text-green-700">✓ ready ({formatBytes(row.match.size)})</span>
                              )}
                              {isMatchCol && row.match && row.fileError && (
                                <span className="ml-1.5 text-[10px] text-amber-700" title={row.fileError}>⚠ {row.fileError}</span>
                              )}
                              {isMatchCol && row.match === null && cellValue && !isHttpUrl(cellValue) && (
                                <span className="ml-1.5 text-[10px] text-amber-700">no file</span>
                              )}
                            </td>
                          );
                        })}
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
              {importing
                ? uploadProgress
                  ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                  : "Importing…"
                : `Import ${validCount} row(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "doc": return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls": return "application/vnd.ms-excel";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt": return "application/vnd.ms-powerpoint";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "txt": return "text/plain";
    case "csv": return "text/csv";
    default: return "application/octet-stream";
  }
}
