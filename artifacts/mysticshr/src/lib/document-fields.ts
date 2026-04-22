// Per-document-type extra fields. The employee request form renders these
// inputs so HR's one-click Generate dialog has values to prefill, instead
// of asking HR to retype designation / ctc / probation period etc. on
// every approval. Keep keys in sync with the substitution variables
// supported by the PDF templates ({{designation}}, {{ctc}}, …).

export type TemplateFieldSpec = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "date";
};

export const DOCUMENT_REQUEST_FIELDS: Record<string, TemplateFieldSpec[]> = {
  "Experience Certificate": [
    { key: "designation", label: "Designation at exit", placeholder: "e.g., Senior Engineer" },
  ],
  "Appointment Letter": [
    { key: "designation", label: "Designation", placeholder: "e.g., Senior Engineer" },
    { key: "ctc", label: "Annual CTC (₹)", placeholder: "e.g., 1200000" },
    { key: "probationPeriod", label: "Probation period", placeholder: "e.g., 6 months" },
  ],
  "Offer Letter": [
    { key: "designation", label: "Designation", placeholder: "e.g., Senior Engineer" },
    { key: "ctc", label: "Annual CTC (₹)", placeholder: "e.g., 1200000" },
    { key: "probationPeriod", label: "Probation period", placeholder: "e.g., 6 months" },
  ],
  "Relieving Letter": [
    { key: "designation", label: "Designation at exit", placeholder: "e.g., Senior Engineer" },
  ],
  NOC: [
    { key: "purpose", label: "Purpose of NOC", placeholder: "e.g., bank loan" },
  ],
  "Warning Notice": [
    { key: "violationDetails", label: "Violation details" },
    { key: "responseDeadline", label: "Response deadline", type: "date" },
  ],
};

export function getDocumentRequestFields(documentType: string): TemplateFieldSpec[] {
  return DOCUMENT_REQUEST_FIELDS[documentType] ?? [];
}

// Union of every key any template can ask for. Used by HR's Generate
// dialog so the optional-fields editor stays comprehensive even when no
// template-specific fields are otherwise specified.
export const ALL_TEMPLATE_FIELD_KEYS: string[] = Array.from(
  new Set(
    Object.values(DOCUMENT_REQUEST_FIELDS).flatMap(specs => specs.map(s => s.key)),
  ),
);
