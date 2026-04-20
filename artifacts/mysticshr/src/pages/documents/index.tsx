import { useState } from "react";
import {
  useListDocumentTemplates,
  useCreateDocumentTemplate,
  useUpdateDocumentTemplate,
  useListIssuedDocuments,
  useGenerateDocument,
  useListEmployees,
  getListDocumentTemplatesQueryKey,
  getListIssuedDocumentsQueryKey,
  type DocumentTemplate,
  type IssuedDocument,
  type CreateDocumentTemplateBody,
  type GenerateDocumentBody,
  type CreateDocumentTemplateBodyDocumentType,
  type GenerateDocumentBodyDocumentType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, FileText, Download, Settings, Edit } from "lucide-react";

const DOC_TYPES = [
  "Experience Certificate",
  "Appointment Letter",
  "Warning Notice",
  "Offer Letter",
  "NOC",
  "Relieving Letter",
] as const;

type DocType = (typeof DOC_TYPES)[number];

function TemplateForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial: Partial<CreateDocumentTemplateBody>;
  onSave: (data: CreateDocumentTemplateBody) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<CreateDocumentTemplateBody>({
    documentType: initial.documentType ?? "Experience Certificate",
    name: initial.name ?? "",
    companyName: initial.companyName ?? null,
    companyAddress: initial.companyAddress ?? null,
    headerText: initial.headerText ?? null,
    footerText: initial.footerText ?? null,
    bodyTemplate: initial.bodyTemplate ?? "",
    isActive: initial.isActive ?? true,
  });

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Document Type *</Label>
          <Select value={form.documentType} onValueChange={(v: DocType) => setForm(f => ({ ...f, documentType: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Template Name *</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Company Name</Label>
          <Input value={form.companyName ?? ""} onChange={e => setForm(f => ({ ...f, companyName: e.target.value || null }))} />
        </div>
        <div>
          <Label>Company Address</Label>
          <Input value={form.companyAddress ?? ""} onChange={e => setForm(f => ({ ...f, companyAddress: e.target.value || null }))} />
        </div>
      </div>
      <div>
        <Label>Header Text</Label>
        <Input value={form.headerText ?? ""} onChange={e => setForm(f => ({ ...f, headerText: e.target.value || null }))} placeholder="e.g., ISO 9001:2015 Certified" />
      </div>
      <div>
        <Label>Body Template *</Label>
        <p className="text-xs text-muted-foreground mb-1">Use {"{{fieldName}}"} for dynamic values. Available: {"{{employeeName}}"}, {"{{employeeCode}}"}, {"{{dateOfJoining}}"}, {"{{lastWorkingDay}}"}, {"{{currentDate}}"}</p>
        <Textarea rows={8} value={form.bodyTemplate} onChange={e => setForm(f => ({ ...f, bodyTemplate: e.target.value }))} required
          placeholder="To Whomsoever It May Concern,&#10;&#10;This is to certify that {{employeeName}} ({{employeeCode}}) was employed with us from {{dateOfJoining}} to {{lastWorkingDay}}..." />
      </div>
      <div>
        <Label>Footer Text</Label>
        <Input value={form.footerText ?? ""} onChange={e => setForm(f => ({ ...f, footerText: e.target.value || null }))} placeholder="e.g., For Automystics Technologies" />
      </div>
      <div className="flex items-center gap-2">
        <Switch id="active" checked={form.isActive ?? true} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
        <Label htmlFor="active">Active Template</Label>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isPending || !form.name || !form.bodyTemplate}>
          {isPending ? "Saving..." : "Save Template"}
        </Button>
      </div>
    </form>
  );
}

function GenerateModal({
  open,
  onClose,
  templates,
}: {
  open: boolean;
  onClose: () => void;
  templates: DocumentTemplate[];
}) {
  const qc = useQueryClient();
  const generate = useGenerateDocument();
  const { data: empList } = useListEmployees({ status: "Active", limit: 500 });
  const employees = empList?.data ?? [];

  const [employeeId, setEmployeeId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});

  const selectedTemplate = templates.find(t => t.id === Number(templateId));

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !templateId || !selectedTemplate) return;

    const body: GenerateDocumentBody = {
      employeeId: Number(employeeId),
      documentType: selectedTemplate.documentType as GenerateDocumentBodyDocumentType,
      templateId: Number(templateId),
      fieldValues: extraFields,
    };

    generate.mutate({ data: body }, {
      onSuccess: (doc) => {
        qc.invalidateQueries({ queryKey: getListIssuedDocumentsQueryKey() });
        alert(`Document "${doc.filename}" generated successfully!`);
        onClose();
        setEmployeeId("");
        setTemplateId("");
        setExtraFields({});
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <Label>Employee *</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Select employee..." /></SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.firstName} {e.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Template *</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Select template..." /></SelectTrigger>
              <SelectContent>
                {templates.filter(t => t.isActive).map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.documentType})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedTemplate && (
            <div className="space-y-2 rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground font-medium">Optional additional fields (override auto-filled values)</p>
              {["designation", "ctc", "probationPeriod", "violationDetails", "responseDeadline"].map(field => (
                <div key={field} className="flex items-center gap-2">
                  <Label className="w-36 text-xs">{field}</Label>
                  <Input className="h-7 text-xs" value={extraFields[field] ?? ""} onChange={e =>
                    setExtraFields(f => ({ ...f, [field]: e.target.value }))
                  } />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={generate.isPending || !employeeId || !templateId}>
              {generate.isPending ? "Generating..." : "Generate Document"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentRow({ doc }: { doc: IssuedDocument }) {
  function handleDownload() {
    window.open(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/documents/issued/${doc.id}/download`, "_blank");
  }

  return (
    <div className="flex items-center gap-4 p-3 rounded-md border">
      <FileText className="w-5 h-5 text-blue-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{doc.filename}</div>
        <div className="text-xs text-muted-foreground">
          {doc.documentType} • {doc.employeeName ?? `Employee #${doc.employeeId}`}
          {doc.generatedByName && ` • Generated by ${doc.generatedByName}`}
        </div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        {new Date(doc.generatedAt).toLocaleDateString("en-IN")}
      </div>
      <Button size="sm" variant="outline" onClick={handleDownload}>
        <Download className="w-3 h-3 mr-1" />
        Download
      </Button>
    </div>
  );
}

export default function DocumentsPage() {
  const { role } = useCurrentHrmsUser();
  const isHr = ["super_admin", "hr_manager", "hr_executive"].includes(role ?? "");

  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editTemplate, setEditTemplate] = useState<DocumentTemplate | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const { data: templates = [] } = useListDocumentTemplates();
  const { data: issued = [] } = useListIssuedDocuments({});

  const createTemplate = useCreateDocumentTemplate();
  const updateTemplate = useUpdateDocumentTemplate();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">HR Documents</h1>
          <p className="text-muted-foreground text-sm">
            {isHr ? "Manage templates and generate documents for employees" : "View and download your issued documents"}
          </p>
        </div>
        {isHr && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowCreate(true)}>
              <Settings className="w-4 h-4 mr-2" />
              New Template
            </Button>
            <Button onClick={() => setShowGenerate(true)} disabled={templates.filter(t => t.isActive).length === 0}>
              <Plus className="w-4 h-4 mr-2" />
              Generate Document
            </Button>
          </div>
        )}
      </div>

      {isHr ? (
        <Tabs defaultValue="issued">
          <TabsList>
            <TabsTrigger value="issued">Issued Documents ({issued.length})</TabsTrigger>
            <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="issued" className="space-y-3 mt-4">
            {issued.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">No documents issued yet</CardContent></Card>
            ) : (
              <div className="space-y-2">{issued.map(d => <DocumentRow key={d.id} doc={d} />)}</div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-4">
            {showCreate ? (
              <Card>
                <CardHeader><CardTitle>New Template</CardTitle></CardHeader>
                <CardContent>
                  <TemplateForm
                    initial={{}}
                    isPending={createTemplate.isPending}
                    onCancel={() => setShowCreate(false)}
                    onSave={(data) => {
                      createTemplate.mutate({ data }, {
                        onSuccess: () => {
                          qc.invalidateQueries({ queryKey: getListDocumentTemplatesQueryKey() });
                          setShowCreate(false);
                        },
                      });
                    }}
                  />
                </CardContent>
              </Card>
            ) : editTemplate ? (
              <Card>
                <CardHeader><CardTitle>Edit Template — {editTemplate.name}</CardTitle></CardHeader>
                <CardContent>
                  <TemplateForm
                    initial={{ ...editTemplate, documentType: editTemplate.documentType as CreateDocumentTemplateBodyDocumentType }}
                    isPending={updateTemplate.isPending}
                    onCancel={() => setEditTemplate(null)}
                    onSave={(data) => {
                      updateTemplate.mutate({ id: editTemplate.id, data }, {
                        onSuccess: () => {
                          qc.invalidateQueries({ queryKey: getListDocumentTemplatesQueryKey() });
                          setEditTemplate(null);
                        },
                      });
                    }}
                  />
                </CardContent>
              </Card>
            ) : templates.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No templates yet. Create one to start generating documents.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {templates.map(t => (
                  <Card key={t.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-sm text-muted-foreground">{t.documentType}</div>
                        {!t.isActive && <Badge className="mt-1 text-xs bg-gray-100 text-gray-500">Inactive</Badge>}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setEditTemplate(t)}>
                        <Edit className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        /* Employee view — just issued documents */
        <div className="space-y-2">
          {issued.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No documents have been issued to you yet.</p>
              </CardContent>
            </Card>
          ) : (
            issued.map(d => <DocumentRow key={d.id} doc={d} />)
          )}
        </div>
      )}

      <GenerateModal open={showGenerate} onClose={() => setShowGenerate(false)} templates={templates} />
    </div>
  );
}
