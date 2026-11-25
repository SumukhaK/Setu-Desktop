export interface DoctorCheck {
  name: string;
  status: string;
  detail: string;
  hint: string | null;
}

export type DoctorOutcome =
  | {
      outcome: "report";
      version: string;
      platform: string;
      ok: boolean;
      checks: DoctorCheck[];
    }
  | { outcome: "not_ready" }
  | { outcome: "timed_out" }
  | { outcome: "failed"; code: number | null };

export type DoctorReport = Extract<DoctorOutcome, { outcome: "report" }>;

export interface DiagnosticsPort {
  run(): Promise<DoctorOutcome>;
}
