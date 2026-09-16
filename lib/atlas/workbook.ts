// Server-only I/O boundary. Do not import this module into client components.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as XLSX from "xlsx";
import type { ValidationError, ValidationResult, WorkbookRow } from "./types";
import { validateWorkbook } from "./validate";

const FARM_HEADERS = [
  "farm_id", "farm_name", "expected_daily_capacity_t",
  "expected_A_pct", "expected_B_pct", "expected_C_pct", "expected_D_pct",
  "actual_A_t", "actual_B_t", "actual_C_t", "actual_D_t",
];
const CLIENT_HEADERS = [
  "client_id", "client_name", "acceptance_mode", "requested_segment", "demand_t", "export_price_per_t_eur",
];
const STATION_HEADERS = ["station_id", "export_conditioning_capacity_t", "local_market_ratio"];
const PRICE_HEADERS = ["segment", "reference_export_price_per_t_eur"];

function cellValue(sheet: XLSX.WorkSheet, address: string): unknown {
  const cell: XLSX.CellObject | undefined = sheet[address];
  // Excel error codes can be numeric: never mistake one for tonnes or a price.
  if (cell?.t === "e") return { excelError: cell.w ?? cell.v };
  return cell?.v;
}

function isPresent(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

/** Extract the supplied workbook layout; totals and entity counts are not fixed. */
export function parseWorkbook(workbook: XLSX.WorkBook): ValidationResult {
  const errors: ValidationError[] = [];
  const reportedMissingSheets = new Set<string>();

  function table(
    name: ValidationError["sheet"], headers: readonly string[], headerRow: number, lastRow?: number,
  ): WorkbookRow[] {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      if (!reportedMissingSheets.has(name)) {
        errors.push({ sheet: name, message: `Missing required sheet: ${name}.` });
        reportedMissingSheets.add(name);
      }
      return [];
    }
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    const columns = new Map<string, number>();
    const errorsBeforeHeader = errors.length;
    for (let column = 0; column <= range.e.c; column++) {
      const cell = XLSX.utils.encode_cell({ r: headerRow - 1, c: column });
      const value = cellValue(sheet, cell);
      if (!isPresent(value)) continue;
      if (typeof value !== "string" || !headers.includes(value)) {
        errors.push({ sheet: name, cell, message: `Unexpected column header; expected ${headers.join(", ")}.` });
      } else if (columns.has(value)) {
        errors.push({ sheet: name, field: value, cell, message: `Duplicate column header: ${value}.` });
      } else {
        columns.set(value, column);
      }
    }
    for (const field of headers) {
      if (!columns.has(field)) errors.push({ sheet: name, field, cell: `A${headerRow}`, message: `Missing required column ${field} in header row ${headerRow}.` });
    }
    if (errors.length !== errorsBeforeHeader) return [];

    const result: WorkbookRow[] = [];
    const knownColumns = new Set(columns.values());
    for (let row = headerRow; row <= (lastRow === undefined ? range.e.r : lastRow - 1); row++) {
      const values: Record<string, unknown> = {};
      const cells: Record<string, string> = {};
      let populated = false;
      for (let column = 0; column <= range.e.c; column++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: column });
        const value = cellValue(sheet, cell);
        if (isPresent(value)) {
          populated = true;
          if (!knownColumns.has(column)) errors.push({ sheet: name, cell, message: "Data has no corresponding column header." });
        }
      }
      if (!populated) continue; // Formatting-only and entirely blank rows are not records.
      for (const [field, column] of columns) {
        const cell = XLSX.utils.encode_cell({ r: row, c: column });
        values[field] = cellValue(sheet, cell);
        cells[field] = cell;
      }
      result.push({ sheet: name, values, cells });
    }
    return result;
  }

  const farms = table("Farms", FARM_HEADERS, 4);
  const clients = table("Clients", CLIENT_HEADERS, 4);
  // In this supplied layout, notes start at row 8; prices have their own row-16 header.
  const stations = table("Station", STATION_HEADERS, 4, 7);
  const referencePrices = table("Station", PRICE_HEADERS, 16);
  if (errors.length > 0) return { ok: false, errors };
  return validateWorkbook({ farms, clients, stations, referencePrices });
}

/** Read afresh on each request. File/decoder failures throw; invalid data is returned. */
export async function loadWorkbook(
  path = join(process.cwd(), "data", "Atlas_Fresh_Production_Commercial_Data.xlsx"),
): Promise<ValidationResult> {
  const bytes = await readFile(path);
  return parseWorkbook(XLSX.read(bytes, { type: "buffer", cellDates: false }));
}
