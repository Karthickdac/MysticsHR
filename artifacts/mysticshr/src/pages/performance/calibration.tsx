import { useState } from "react";
import {
  useListPerformanceCycles,
  useGetCalibrationView,
  useComputeAppraisalOutcomes,
  useListAppraisalOutcomes,
  getGetCalibrationViewQueryKey,
  getListAppraisalOutcomesQueryKey,
  type CalibrationRecord,
  type AppraisalOutcome,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, CheckCircle2, AlertCircle, Calculator } from "lucide-react";

const OUTCOME_COLORS: Record<string, string> = {
  "Outstanding": "bg-green-100 text-green-700 border-green-200",
  "Exceeds Expectations": "bg-teal-100 text-teal-700 border-teal-200",
  "Meets Expectations": "bg-blue-100 text-blue-700 border-blue-200",
  "Needs Improvement": "bg-amber-100 text-amber-700 border-amber-200",
  "Unsatisfactory": "bg-red-100 text-red-700 border-red-200",
};

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400 text-sm">—</span>;
  const pct = (score / 5) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-[60px]">
        <div
          className={`h-2 rounded-full ${pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-blue-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-medium tabular-nums">{score.toFixed(2)}</span>
    </div>
  );
}

export default function CalibrationPage() {
  const qc = useQueryClient();
  const [selectedCycle, setSelectedCycle] = useState<string>("");
  const [computing, setComputing] = useState(false);

  const { data: cycles = [] } = useListPerformanceCycles({});
  const cycleId = selectedCycle ? Number(selectedCycle) : null;

  const { data: calibration = [], isLoading: loadingCalib } = useGetCalibrationView(
    cycleId ?? 0,
    { query: { queryKey: getGetCalibrationViewQueryKey(cycleId ?? 0), enabled: !!cycleId } }
  );

  const { data: outcomes = [], isLoading: loadingOutcomes } = useListAppraisalOutcomes(
    { cycleId: cycleId ?? undefined },
    { query: { queryKey: getListAppraisalOutcomesQueryKey({ cycleId: cycleId ?? undefined }), enabled: !!cycleId } }
  );

  const computeOutcomes = useComputeAppraisalOutcomes();

  function handleCompute() {
    if (!cycleId) return;
    setComputing(true);
    computeOutcomes.mutate(
      { data: { cycleId } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/performance/outcomes"] });
          setComputing(false);
        },
        onError: () => setComputing(false),
      }
    );
  }

  const outcomesMap = Object.fromEntries(outcomes.map(o => [o.employeeId, o]));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-rose-600" /> Calibration Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review weighted scores and finalize appraisal outcomes
          </p>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <Select value={selectedCycle} onValueChange={setSelectedCycle}>
          <SelectTrigger className="w-72 h-9">
            <SelectValue placeholder="Select a cycle to calibrate" />
          </SelectTrigger>
          <SelectContent>
            {cycles.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.title} ({c.status})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {cycleId && calibration.length > 0 && (
          <Button onClick={handleCompute} disabled={computing || computeOutcomes.isPending}>
            <Calculator className="w-4 h-4 mr-1" />
            {computing ? "Computing..." : "Compute Outcomes"}
          </Button>
        )}
      </div>

      {!selectedCycle ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Select a performance cycle to view calibration data.</p>
          </CardContent>
        </Card>
      ) : loadingCalib ? (
        <div className="text-sm text-muted-foreground">Loading calibration data...</div>
      ) : calibration.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No calibration data found. Ensure goals and ratings have been submitted.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{calibration.length}</p>
                <p className="text-sm text-muted-foreground">Employees</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold">
                  {calibration.filter(r => r.managerScore !== null).length}
                </p>
                <p className="text-sm text-muted-foreground">Manager Evaluated</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold">
                  {calibration.filter(r => r.selfScore !== null).length}
                </p>
                <p className="text-sm text-muted-foreground">Self Appraised</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{outcomes.length}</p>
                <p className="text-sm text-muted-foreground">Outcomes Computed</p>
              </CardContent>
            </Card>
          </div>

          {/* Calibration Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Score Matrix</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Goals</TableHead>
                      <TableHead>Self Score</TableHead>
                      <TableHead>Manager Score</TableHead>
                      <TableHead>Weighted Score</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calibration.map(record => {
                      const outcome = outcomesMap[record.employeeId];
                      return (
                        <TableRow key={record.employeeId}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{record.employeeName ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">{record.employeeCode ?? ""}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{record.department ?? "—"}</TableCell>
                          <TableCell className="text-sm">{record.goalCount}</TableCell>
                          <TableCell><ScoreBar score={record.selfScore ?? null} /></TableCell>
                          <TableCell><ScoreBar score={record.managerScore ?? null} /></TableCell>
                          <TableCell><ScoreBar score={record.weightedScore ?? null} /></TableCell>
                          <TableCell>
                            {outcome?.outcomLabel ? (
                              <Badge variant="outline" className={OUTCOME_COLORS[outcome.outcomLabel] ?? ""}>
                                {outcome.outcomLabel}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Pending</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Outcomes breakdown */}
          {outcomes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" /> Final Outcomes
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Final Score</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Calibration Note</TableHead>
                        <TableHead>Computed At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outcomes.map(o => (
                        <TableRow key={o.id}>
                          <TableCell>
                            <p className="font-medium text-sm">{o.employeeName ?? `Employee #${o.employeeId}`}</p>
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold">{o.finalScore ?? "—"}</span>
                          </TableCell>
                          <TableCell>
                            {o.outcomLabel ? (
                              <Badge variant="outline" className={OUTCOME_COLORS[o.outcomLabel] ?? ""}>
                                {o.outcomLabel}
                              </Badge>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{o.calibrationNote ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(o.calculatedAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
