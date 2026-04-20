import { useState } from "react";
import { Link, useRoute } from "wouter";
import {
  useGetPreOnboardingRecord,
  useListPreOnboardingDocuments,
  useUpdatePreOnboardingDocument,
  useVerifyPreOnboardingDocument,
  useRejectPreOnboardingDocument,
  useUpdatePreOnboardingRecord,
  getListPreOnboardingDocumentsQueryKey,
  getGetPreOnboardingRecordQueryKey,
  getListPreOnboardingRecordsQueryKey,
} from "@workspace/api-client-react";
import type { PreOnboardingDocument } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2, XCircle, Upload } from "lucide-react";
import { useCurrentHrmsUser, hasRole } from "@/lib/useCurrentHrmsUser";

const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-gray-100 text-gray-700",
  Uploaded: "bg-blue-100 text-blue-800",
  Verified: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
};

const RECORD_STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
};

function DocumentRow({ doc, recordId }: { doc: PreOnboardingDocument; recordId: number }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(doc.fileUrl ?? "");
  const { role } = useCurrentHrmsUser();
  const canManage = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListPreOnboardingDocumentsQueryKey(recordId) });
    qc.invalidateQueries({ queryKey: getGetPreOnboardingRecordQueryKey(recordId) });
    qc.invalidateQueries({ queryKey: getListPreOnboardingRecordsQueryKey() });
  };

  const update = useUpdatePreOnboardingDocument({ mutation: { onSuccess: invalidate } });
  const verify = useVerifyPreOnboardingDocument({ mutation: { onSuccess: invalidate } });
  const reject = useRejectPreOnboardingDocument({ mutation: { onSuccess: invalidate } });

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{doc.documentName}</span>
            <Badge variant="outline" className="text-xs">{doc.documentType}</Badge>
            <Badge className={STATUS_COLORS[doc.status] ?? ""}>{doc.status}</Badge>
            {doc.isRequired === 1 && <Badge variant="secondary" className="text-xs">Required</Badge>}
          </div>
          {doc.uploadedAt && (
            <div className="text-xs text-muted-foreground mt-1">
              Uploaded: {new Date(doc.uploadedAt).toLocaleString()}
            </div>
          )}
          {doc.verifiedAt && doc.verifiedByName && (
            <div className="text-xs text-muted-foreground">
              {doc.status === "Verified" ? "Verified" : "Reviewed"} by {doc.verifiedByName} on {new Date(doc.verifiedAt).toLocaleString()}
            </div>
          )}
          {doc.rejectionReason && (
            <div className="text-xs text-red-700 mt-1">Reason: {doc.rejectionReason}</div>
          )}
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Document file URL"
            className="flex-1 min-w-[200px] h-8 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!url || url === doc.fileUrl || update.isPending}
            onClick={() => update.mutate({ docId: doc.id, data: { fileUrl: url } })}
          >
            <Upload className="w-3 h-3 mr-1" />Save URL
          </Button>
          {doc.fileUrl && (
            <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View</a>
          )}
          {doc.status !== "Verified" && (
            <Button size="sm" variant="outline" onClick={() => verify.mutate({ docId: doc.id })} disabled={verify.isPending}>
              <CheckCircle2 className="w-3 h-3 mr-1" />Verify
            </Button>
          )}
          {doc.status !== "Rejected" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const reason = prompt("Rejection reason:");
                if (reason) reject.mutate({ docId: doc.id, data: { reason } });
              }}
              disabled={reject.isPending}
            >
              <XCircle className="w-3 h-3 mr-1" />Reject
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function PreOnboardingDetailPage() {
  const [, params] = useRoute<{ id: string }>("/pre-onboarding/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;
  const qc = useQueryClient();
  const { data: record, isLoading } = useGetPreOnboardingRecord(id);
  const { data: docs } = useListPreOnboardingDocuments(id);
  const { role } = useCurrentHrmsUser();
  const canEdit = hasRole(role, ["super_admin", "hr_manager", "hr_executive"]);

  const updateRecord = useUpdatePreOnboardingRecord({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPreOnboardingRecordQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListPreOnboardingRecordsQueryKey() });
      },
    },
  });

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  if (!record) return <div className="text-center py-12 text-muted-foreground">Record not found</div>;

  return (
    <div className="space-y-6">
      <Link href="/pre-onboarding" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4 mr-1" />Back to Pre-Onboarding
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>{record.candidateName ?? `Candidate #${record.candidateId}`}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{record.candidateEmail ?? ""}</p>
            </div>
            <Badge className={RECORD_STATUS_COLORS[record.status] ?? ""}>{record.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><div className="text-muted-foreground text-xs">Expected Joining</div><div className="font-medium">{record.expectedJoiningDate}</div></div>
            <div><div className="text-muted-foreground text-xs">Created</div><div className="font-medium">{new Date(record.createdAt).toLocaleDateString()}</div></div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Required Document Verification</span>
              <span className="font-medium">{record.completionPercentage}%</span>
            </div>
            <Progress value={record.completionPercentage} className="h-2" />
          </div>
          {canEdit && record.status !== "Cancelled" && (
            <div className="flex gap-2 pt-2 border-t">
              {record.status !== "Cancelled" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (confirm("Cancel this pre-onboarding?")) updateRecord.mutate({ id, data: { status: "Cancelled" } });
                  }}
                >
                  Cancel Pre-Onboarding
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Documents ({docs?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!docs?.length ? (
            <div className="text-center text-muted-foreground py-8">No documents</div>
          ) : (
            docs.map((d) => <DocumentRow key={d.id} doc={d} recordId={id} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
