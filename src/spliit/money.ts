import type { Group } from "./schemas";

export interface CurrencySpec {
  code?: string;
  symbol: string;
  decimalDigits: number;
}

export function currencySpec(group: Group): CurrencySpec {
  const code = group.currencyCode?.trim().toUpperCase();
  if (code === undefined || code === "") {
    return { symbol: group.currency, decimalDigits: 2 };
  }

  try {
    const decimalDigits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return { code, symbol: group.currency, decimalDigits };
  } catch {
    return { code, symbol: group.currency, decimalDigits: 2 };
  }
}

export function minorToDecimal(minor: number, decimalDigits: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Money amount is outside the supported integer range");
  }
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor).toString().padStart(decimalDigits + 1, "0");
  if (decimalDigits === 0) return `${sign}${absolute}`;
  const whole = absolute.slice(0, -decimalDigits);
  const fraction = absolute.slice(-decimalDigits);
  return `${sign}${whole}.${fraction}`;
}

export function decimalToMinor(value: string, decimalDigits: number): number {
  const normalized = value.trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (match === null) {
    throw new Error("Amount must be a decimal string such as 12.50");
  }

  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] ?? "0";
  const suppliedFraction = match[3] ?? "";
  const significantExtra = suppliedFraction.slice(decimalDigits).replace(/0/g, "");
  if (significantExtra !== "") {
    throw new Error(`Amount supports at most ${decimalDigits} decimal places`);
  }

  const fraction = suppliedFraction
    .slice(0, decimalDigits)
    .padEnd(decimalDigits, "0");
  const scale = 10 ** decimalDigits;
  const result = sign * (Number(whole) * scale + Number(fraction || "0"));
  if (!Number.isSafeInteger(result) || Math.abs(result) > 1_000_000_000) {
    throw new Error("Amount is outside Spliit's supported range");
  }
  if (result === 0) {
    throw new Error("Amount cannot be zero");
  }
  return result;
}

export function moneyOutput(minor: number, currency: CurrencySpec): {
  amount: string;
  amountMinor: number;
  currency: string;
} {
  return {
    amount: minorToDecimal(minor, currency.decimalDigits),
    amountMinor: minor,
    currency: currency.code ?? currency.symbol
  };
}
