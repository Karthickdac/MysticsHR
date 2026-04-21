import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentHrmsUser } from "@/lib/useCurrentHrmsUser";
import { ArrowLeft, History } from "lucide-react";
import PerformanceHistoryView from "@/components/PerformanceHistoryView";

export default function PerformanceHistoryPage() {
  const [, navigate] = useLocation();
  const { hrmsUser, isLoading: userLoading } = useCurrentHrmsUser();
  const employeeId = hrmsUser?.employeeId ?? undefined;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => navigate("/performance")}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="w-6 h-6 text-primary" />
            Performance History
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Your appraisal outcomes and ratings across past cycles
          </p>
        </div>
      </div>

      {!userLoading && !employeeId ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No employee record is linked to your account.</p>
            <p className="text-xs mt-1">Ask HR to link your user to an employee profile to view your performance history.</p>
          </CardContent>
        </Card>
      ) : (
        <PerformanceHistoryView employeeId={employeeId} enabled={!userLoading} />
      )}
    </div>
  );
}
