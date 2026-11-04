import type { ParsedGs1 } from './types';

const separator = String.fromCharCode(29);
const validAi = /^(01|13|21|10|00|320[0-9])/;

export function isValidGtin(value: string) {
  if (!/^(?:\d{8}|\d{12,14})$/.test(value)) return false;
  const digits = value.split('').map(Number); const check = digits.pop()!;
  return digits.reverse().reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0) % 10 === (10 - check) % 10;
}

/** Conservative GS1 parsing. It only accepts an explicit AI stream, never guesses from naked digits. */
export function parseGs1(raw: string): ParsedGs1 | null {
  // Parenthesized GS1 is human-readable notation, not proof that the scanner
  // supplied an encoded AI stream. Preserve it for an explicit manual parser
  // later; never silently reinterpret it as raw scanner data.
  if (raw.includes('(') || raw.includes(')')) return null;
  const value = raw.replace(/^\][A-Za-z]\d/, '');
  if (!validAi.test(value)) return null;
  const output: ParsedGs1 = { warnings: [] }; let cursor = 0;
  const take = (length: number) => { const result = value.slice(cursor, cursor + length); cursor += length; return result; };
  while (cursor < value.length) {
    const ai = value.slice(cursor, cursor + 2);
    if (ai === '01') { cursor += 2; const id = take(14); if (!/^\d{14}$/.test(id)) return null; output.itemIdentifier = id; continue; }
    if (ai === '13') { cursor += 2; const date = take(6); if (!/^\d{6}$/.test(date)) return null; const parsedDate = new Date(Date.UTC(2000 + Number(date.slice(0, 2)), Number(date.slice(2, 4)) - 1, Number(date.slice(4, 6)))); if (parsedDate.getUTCFullYear() !== 2000 + Number(date.slice(0, 2)) || parsedDate.getUTCMonth() !== Number(date.slice(2, 4)) - 1 || parsedDate.getUTCDate() !== Number(date.slice(4, 6))) return null; output.packDate = `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`; continue; }
    if (ai === '00') { cursor += 2; const sscc = take(18); if (!/^\d{18}$/.test(sscc)) return null; output.sscc = sscc; continue; }
    if (ai === '21' || ai === '10') { cursor += 2; const next = value.indexOf(separator, cursor); const data = next === -1 ? value.slice(cursor) : value.slice(cursor, next); cursor = next === -1 ? value.length : next + 1; if (!data) return null; if (ai === '21') output.serial = data; else output.lot = data; continue; }
    const weightAi = value.slice(cursor, cursor + 4);
    if (/^320[0-9]$/.test(weightAi)) { cursor += 4; const encoded = take(6); if (!/^\d{6}$/.test(encoded)) return null; const decimals = Number(weightAi[3]); output.netWeight = Number(encoded) / 10 ** decimals; output.weightUom = 'LB'; continue; }
    output.warnings.push(`Unsupported GS1 AI near character ${cursor + 1}.`); return null;
  }
  return output;
}
