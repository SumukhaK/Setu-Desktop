export interface CodeInput {
  display: string;
  code: string | null;
  problem: "characters" | "length" | null;
}

export function parseCodeInput(raw: string): CodeInput {
  return { display: raw, code: null, problem: null };
}
