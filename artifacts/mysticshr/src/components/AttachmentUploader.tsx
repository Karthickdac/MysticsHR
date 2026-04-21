import { useRef, useState } from "react";
import { requestUploadUrl } from "@workspace/api-client-react";

export type UploadedAttachment = {
  objectPath: string;
  fileName: string;
  fileSize: number;
  contentType: string;
};

const MAX_BYTES = 10 * 1024 * 1024;
// Mirrors the server-side allowlist in artifacts/api-server/src/routes/storage.ts
const ALLOWED_TYPES = new Set<string>([
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

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isAllowed(contentType: string) {
  return ALLOWED_TYPES.has(contentType);
}

export function AttachmentUploader({
  value,
  onChange,
  disabled,
  label = "Attachments",
}: {
  value: UploadedAttachment[];
  onChange: (next: UploadedAttachment[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const next: UploadedAttachment[] = [...value];
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          throw new Error(`"${file.name}" exceeds 10 MB`);
        }
        if (!isAllowed(file.type)) {
          throw new Error(`"${file.name}" file type (${file.type || "unknown"}) is not allowed`);
        }
        const { uploadURL, objectPath } = await requestUploadUrl({
          name: file.name,
          size: file.size,
          contentType: file.type,
        });
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Upload failed for "${file.name}" (${putRes.status})`);
        next.push({
          objectPath,
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type,
        });
      }
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Add file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((a, i) => (
            <li
              key={`${a.objectPath}-${i}`}
              className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5"
            >
              <span className="truncate mr-2">
                {a.fileName} <span className="text-slate-500">({formatBytes(a.fileSize)})</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(i)}
                className="text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">Images, PDF, Word, Excel, text. Max 10 MB per file.</p>
    </div>
  );
}

export function AttachmentList({
  attachments,
  onDelete,
  currentUserId,
}: {
  attachments: Array<{
    id: number;
    fileName: string;
    fileSize: number;
    contentType: string;
    objectPath: string;
    uploadedByUserId?: number | null;
    uploadedByName?: string | null;
    createdAt?: string | Date | null;
  }>;
  onDelete?: (attachmentId: number) => void;
  currentUserId?: number | null;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {attachments.map(a => {
        const url = `/api/storage${a.objectPath}`;
        const canDelete = onDelete && (currentUserId == null || a.uploadedByUserId === currentUserId);
        // Show an inline thumbnail for image MIME types so triagers can scan
        // attached screenshots at a glance instead of opening each one. The
        // thumbnail itself is a link that opens the full image in a new tab,
        // matching the behaviour of the filename link beside it.
        const isImage = typeof a.contentType === "string" && a.contentType.startsWith("image/");
        return (
          <li key={a.id} className="flex items-center justify-between gap-3 text-xs bg-white border border-slate-200 rounded px-2 py-1.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isImage && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 block w-12 h-12 rounded border border-slate-200 overflow-hidden bg-slate-50"
                  title={`Open ${a.fileName} in a new tab`}
                >
                  <img
                    src={url}
                    alt={a.fileName}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate block">
                  {a.fileName}
                </a>
                <div className="text-[11px] text-slate-500">
                  {formatBytes(a.fileSize)}
                  {a.uploadedByName ? ` · ${a.uploadedByName}` : ""}
                </div>
              </div>
            </div>
            {canDelete && (
              <button
                type="button"
                onClick={() => onDelete!(a.id)}
                className="text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
