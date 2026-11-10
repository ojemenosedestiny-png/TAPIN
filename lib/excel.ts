import ExcelJS from "exceljs";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, headerToKey, type ImportKey } from "@/lib/import";

/** Server only. Reads the first worksheet of an .xlsx into header-keyed rows. */
export async function readImportWorkbook(data: ArrayBuffer): Promise<
  { ok: true; rows: { row: number; values: Partial<Record<ImportKey, string>> }[]; unknownHeaders: string[] } | { ok: false; error: string }
> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    return { ok: false, error: "That file isn't a readable Excel (.xlsx) workbook." };
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) return { ok: false, error: "The first sheet is empty. Put headers in row 1 and students from row 2." };
  if (ws.rowCount - 1 > MAX_IMPORT_ROWS) return { ok: false, error: `Too many rows. Import at most ${MAX_IMPORT_ROWS} students at a time.` };

  const colKeys = new Map<number, ImportKey>();
  const unknownHeaders: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    const header = cellText(cell.value);
    if (!header) return;
    const key = headerToKey(header);
    if (key && ![...colKeys.values()].includes(key)) colKeys.set(col, key);
    else unknownHeaders.push(header);
  });

  const missing = IMPORT_COLUMNS.filter((c) => c.required && ![...colKeys.values()].includes(c.key)).map((c) => c.label);
  if (missing.length) return { ok: false, error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the expected headers.` };

  const rows: { row: number; values: Partial<Record<ImportKey, string>> }[] = [];
  ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Partial<Record<ImportKey, string>> = {};
    for (const [col, key] of colKeys) values[key] = cellText(r.getCell(col).value);
    rows.push({ row: rowNumber, values });
  });
  return { ok: true, rows, unknownHeaders };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v && typeof v.text === "string") return v.text.trim(); // hyperlink
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formula
  }
  return String(v).trim();
}

/** The downloadable import template. */
export async function buildImportTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TapIn";
  const ws = wb.addWorksheet("Students");
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  ws.addRow(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example])));
  // Keep phone numbers as text so Excel doesn't drop the leading 0.
  for (const key of ["guardian_phone", "guardian2_phone", "admission_no"]) ws.getColumn(key).numFmt = "@";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
