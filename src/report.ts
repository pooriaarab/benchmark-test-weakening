import { bootstrapCI, type Benchmark, type JsonValue, type RunReport, type Task } from "benchmark-core";

export interface ShieldBreakdown {
  scoredRows: number;
  meanShieldRatio: number | null;
  mutantsKilled: number;
  originalMutantsKilled: number;
  mutantsTotal: number;
  flags: Record<string, number>;
}
export type EnrichedReport = RunReport & { breakdown: ShieldBreakdown };

type Row = RunReport["rows"][number];
type EnrichedRow = Row & { details?: Record<string, JsonValue> };

const asDetails = (value: JsonValue | undefined): Record<string, JsonValue> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;

export function breakdownFromDetails(list: ReadonlyArray<Record<string, JsonValue>>): ShieldBreakdown {
  const flags: Record<string, number> = {};
  let shield = 0; let killed = 0; let originalKilled = 0; let total = 0;
  for (const details of list) {
    if (typeof details.shieldRatio === "number") shield += details.shieldRatio;
    if (typeof details.mutantsKilled === "number") killed += details.mutantsKilled;
    if (typeof details.originalMutantsKilled === "number") originalKilled += details.originalMutantsKilled;
    if (typeof details.mutantsTotal === "number") total += details.mutantsTotal;
    for (const [key, value] of Object.entries(details)) if (value === true) flags[key] = (flags[key] ?? 0) + 1;
  }
  return {
    scoredRows: list.length,
    meanShieldRatio: list.length === 0 ? null : shield / list.length,
    mutantsKilled: killed,
    originalMutantsKilled: originalKilled,
    mutantsTotal: total,
    flags,
  };
}

export async function rescoreRows<T extends Task>(benchmark: Benchmark<T>, rows: readonly Row[], seed: number): Promise<EnrichedRow[]> {
  const scored: EnrichedRow[] = [];
  for (const row of rows) {
    const task = row.submission === undefined ? undefined : await benchmark.getTask(row.taskId);
    if (!task || row.submission === undefined) { scored.push(row); continue; }
    const grade = await benchmark.score(task, row.submission, { seed });
    const details = asDetails(grade.details);
    scored.push({ ...row, score: grade.score, reason: grade.reason, ...(details ? { details } : {}) });
  }
  return scored;
}

export async function enrichReport<T extends Task>(benchmark: Benchmark<T>, report: RunReport): Promise<EnrichedReport> {
  const rows = await rescoreRows(benchmark, report.rows, report.seed);
  const details = rows.map((row) => row.details).filter((item): item is Record<string, JsonValue> => item !== undefined);
  return { ...report, rows, breakdown: breakdownFromDetails(details) };
}

export async function rescoreReport<T extends Task>(benchmark: Benchmark<T>, report: RunReport): Promise<EnrichedReport> {
  const rows = await rescoreRows(benchmark, report.rows, report.seed);
  const scores = rows.map((row) => row.score);
  const details = rows.map((row) => row.details).filter((item): item is Record<string, JsonValue> => item !== undefined);
  const mean = scores.length === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return { ...report, rows, mean, confidenceInterval95: bootstrapCI(scores, report.seed), breakdown: breakdownFromDetails(details) };
}

export function breakdownLines(breakdown: ShieldBreakdown): string {
  const ratio = breakdown.meanShieldRatio === null ? "n/a" : breakdown.meanShieldRatio.toFixed(2);
  const flags = Object.entries(breakdown.flags).map(([key, count]) => `${key}=${count}`).join(" ") || "none";
  return `Shield breakdown: mean ratio ${ratio}; mutants killed ${breakdown.mutantsKilled}/${breakdown.mutantsTotal} by final suites, ${breakdown.originalMutantsKilled}/${breakdown.mutantsTotal} by originals; flags: ${flags}`;
}
