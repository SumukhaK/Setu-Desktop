export interface CodeInput {
  display: string;
  code: string | null;
  problem: "characters" | "length" | null;
}

export function parseCodeInput(raw: string): CodeInput {
  const trimmed = raw.trim();
  if (/[^0-9\- ]/.test(trimmed)) {
    return { display: raw, code: null, problem: "characters" };
  }
  const digits = trimmed.replace(/[-\s]/g, "");
  if (digits.length > 10) {
    return { display: format(digits.slice(0, 10)), code: null, problem: "length" };
  }
  const valid = /^\d{10}$/.test(trimmed) || /^\d{4}[- ]\d{6}$/.test(trimmed);
  return { display: format(digits), code: valid ? format(digits) : null, problem: null };
}

function format(digits: string): string {
  if (digits.length <= 4) {
    return digits;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}
