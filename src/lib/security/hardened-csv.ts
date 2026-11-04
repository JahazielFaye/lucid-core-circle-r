import Papa from 'papaparse';

export type HardenedCsvFile = {
  headers: string[];
  rows: string[][];
};

const MAX_BYTES = 2_000_000;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;
const MAX_HEADER_LENGTH = 200;
const MAX_FIELD_LENGTH = 10_000;

/**
 * Keeps spreadsheet-style formulas as inert text. The source value is retained
 * after a leading apostrophe, which prevents formula execution on display/export.
 */
export function neutralizeCsvCell(value: string) {
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

/** Shared bounded CSV parser for all user-supplied import paths. */
export function readHardenedCsv(buffer: ArrayBuffer): HardenedCsvFile {
  if (buffer.byteLength > MAX_BYTES) throw new Error('Use a CSV file smaller than 2 MB.');

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('The file must be valid UTF-8 CSV text.');
  }
  if (text.includes('\0')) throw new Error('The file is not valid CSV text.');

  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true, dynamicTyping: false });
  if (parsed.errors.length) throw new Error('The CSV file is malformed.');
  const grid = parsed.data;
  if (grid.length < 2) throw new Error('Add a header row and at least one record.');
  if (grid.length > MAX_ROWS + 1 || grid[0]?.length > MAX_COLUMNS) {
    throw new Error('Use a file with at most 500 rows and 100 columns.');
  }

  const headers = grid[0].map((value) => String(value).replace(/^\uFEFF/, ''));
  if (headers.some((header) => !header.trim()) || new Set(headers).size !== headers.length) {
    throw new Error('Column headings must be present and unique.');
  }
  if (headers.some((header) => header.length > MAX_HEADER_LENGTH) || grid.some((row) => row.some((value) => String(value).length > MAX_FIELD_LENGTH))) {
    throw new Error('The CSV contains an oversized header or field.');
  }

  const rows = grid.slice(1)
    .filter((row) => row.some((value) => String(value).trim()))
    .map((row) => headers.map((_, index) => neutralizeCsvCell(String(row[index] ?? ''))));
  if (!rows.length || rows.length > MAX_ROWS) throw new Error('Use between 1 and 500 records.');
  return { headers, rows };
}
