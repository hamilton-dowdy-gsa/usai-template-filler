// src/lib/dbLoader.js
import * as XLSX from "xlsx";

/**
 * Read a workbook (ArrayBuffer) and extract sheets by name into JS objects.
 * Each sheet's first row is treated as the header.
 * Empty cells become "" (defval).
 */

// ---------- helpers ----------
function sheetToObjects(ws) {
  // XLSX.utils.sheet_to_json automatically uses the first row as headers.
  // defval: "" ensures empty cells are not turned into undefined.
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function getSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return sheetToObjects(ws);
}

function coerceBoolean(v) {
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "y" || s === "1") return true;
  if (s === "false" || s === "no" || s === "n" || s === "0") return false;
  return false;
}

function coerceNumber(v) {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isNaN(n) ? NaN : n;
}

/**
 * Apply light type coercion per table so downstream logic is simpler.
 * These are non-destructive (unknown fields are left as-is).
 */
function normalizeTemplates(rows) {
  // "Document Table"
  // Common columns: Name, Variable_Array, Default_Answers, Doc_URL, Title_Format ...
  return rows.map(r => ({ ...r }));
}

function normalizeVariables(rows) {
  // "Variable Table"
  // Important fields: Variable_ID, Name, Object_Name, Variable_Type, Default_Value,
  // Entry_Type, Entry_Category, Helper_Text, Priority, Function, BQ_Table, Reference_Variable, Options
  return rows.map(r => ({
    ...r,
    Variable_ID: coerceNumber(r.Variable_ID),
    Priority: r.Priority === "" ? "" : coerceNumber(r.Priority),
  }));
}

function normalizeClauses(rows) {
  // "Clause Table"
  // Important: PC_ID, Name, Include_If_List, Exclude_If_List, Clause_Text, Full_Text, Internal_Variables, Tags_Array
  return rows.map(r => ({
    ...r,
    PC_ID: coerceNumber(r.PC_ID),
    Full_Text: coerceBoolean(r.Full_Text),
  }));
}

function normalizeTags(rows) {
  // "Tag Table"
  // Important: Tag_ID, Tag, Tag_Category, Question, Entry_Type, Entry_Category,
  // Mutually_Exclusive, Helper_Text, Priority, Options, Logic_Tied_Clause
  return rows.map(r => ({
    ...r,
    Tag_ID: coerceNumber(r.Tag_ID),
    Mutually_Exclusive: coerceBoolean(r.Mutually_Exclusive),
    Priority: r.Priority === "" ? "" : coerceNumber(r.Priority),
  }));
}

function normalizeEntryCategories(rows) {
  // "EntryCategory Table" (optional)
  // Expected columns (flexible): Entry_Category, UI_Type, Options
  return rows.map(r => ({ ...r }));
}

function normalizeTagCategories(rows) {
  // "TagCategory Table" (optional)
  // Expected columns: Tag_Category, Priority (or Priority_Order)
  return rows.map(r => ({ ...r }));
}

function normalizeVariableCategories(rows) {
  // "VariableCategory Table" (optional)
  // Expected columns: Variable_Category, Priority
  return rows.map(r => ({ ...r }));
}

// ---------- public API ----------
/**
 * Load a multi-sheet workbook from /public (e.g., "/DB.xlsx")
 * Returns an object with all tables; missing tabs become [].
 *
 * Sheets expected (case-sensitive):
 *  - "Document Table"
 *  - "Variable Table"
 *  - "Clause Table"
 *  - "Tag Table"
 *  - "EntryCategory Table"         (optional but recommended)
 *  - "TagCategory Table"           (optional)
 *  - "VariableCategory Table"      (optional)
 */
export async function loadWorkbookFromPublic(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${path}`);
  const ab = await res.arrayBuffer();

  const wb = XLSX.read(ab, { type: "array" });

  const rawTemplates = getSheet(wb, "Document Table");
  const rawVariables = getSheet(wb, "Variable Table");
  const rawClauses = getSheet(wb, "Clause Table");
  const rawTags = getSheet(wb, "Tag Table");

  const rawEntryCategories = getSheet(wb, "EntryCategory Table");       // optional
  const rawTagCategories = getSheet(wb, "TagCategory Table");           // optional
  const rawVariableCategories = getSheet(wb, "VariableCategory Table"); // optional

  // Normalize / coerce types
  const templates = normalizeTemplates(rawTemplates);
  const variables = normalizeVariables(rawVariables);
  const clauses = normalizeClauses(rawClauses);
  const tags = normalizeTags(rawTags);

  const entryCategories = normalizeEntryCategories(rawEntryCategories);
  const tagCategories = normalizeTagCategories(rawTagCategories);
  const variableCategories = normalizeVariableCategories(rawVariableCategories);

  return {
    templates,
    variables,
    clauses,
    tags,
    entryCategories,
    tagCategories,
    variableCategories,
  };
}

/**
 * Convenience: load a single CSV (if you ever split the tables into separate CSVs).
 * Not used by App.jsx by default, but handy to keep around.
 */
export async function loadCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  const text = await res.text();
  // Parse CSV to array-of-objects using XLSX
  const wb = XLSX.read(text, { type: "string" });
  const first = wb.SheetNames[0];
  return sheetToObjects(wb.Sheets[first]);
}
