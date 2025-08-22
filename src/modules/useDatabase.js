import * as XLSX from "xlsx";
import { useEffect, useMemo, useState } from "react";

/** ---------- helpers ---------- */
const SPLIT_RE = /[,;|]+/;
const canon = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const findCol = (hdr, name) => {
  const rx = new RegExp(`^${name}$`, "i");
  for (let i = 0; i < hdr.length; i++) {
    const h = String(hdr[i] ?? "").replace(/_/g, " ").trim();
    if (rx.test(h)) return i;
  }
  return -1;
};

function toAoA(wb, name) {
  const ws = wb.Sheets[name];
  return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) : null;
}

/** Parse EntryCategory table (sheet name: "EntryCategory Table" or "EntryCategory")
 *  Uses columns:
 *   - Category  (key used by Tag Table.Entry_Category)
 *   - Options   (comma/semicolon/pipe separated)
 *  Returns: { table: AoA|null, map: Map<canon(Category), string[]> }
 */
function parseEntryCategory(wb) {
  const ws =
    wb.Sheets["EntryCategory Table"] ||
    wb.Sheets["EntryCategory"] ||
    null;

  if (!ws) {
    console.warn('[DB] "EntryCategory Table" not found — continuing without dropdown catalogs.');
    return { table: null, map: new Map() };
  }

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  if (!aoa.length) return { table: aoa, map: new Map() };

  const head = aoa[0];
  const iCat = findCol(head, "category"); // you asked to keep "Category" as the header
  const iOpt = findCol(head, "options") !== -1 ? findCol(head, "options")
            : findCol(head, "answers") !== -1 ? findCol(head, "answers")
            : findCol(head, "values");

  if (iCat === -1 || iOpt === -1) {
    console.warn(
      '[DB] "EntryCategory Table" missing required columns (Category, Options). Options can also be named "Answers" or "Values".'
    );
  }

  const map = new Map();
  for (const row of aoa.slice(1)) {
    const key = canon(row[iCat]);
    if (!key) continue;
    const list = String(row[iOpt] ?? "")
      .split(SPLIT_RE)
      .map((s) => s.trim())
      .filter(Boolean);
    map.set(key, list);
  }
  return { table: aoa, map };
}

export function useDatabase() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tables, setTables]   = useState(null);
  const [templates, setTemplates] = useState([]);
  const [entryOptionsMap, setEntryOptionsMap] = useState(new Map());

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Load /DB.xlsx from /public (cache bust to avoid stale files while dev)
        const resp = await fetch(`/DB.xlsx?ts=${Date.now()}`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} loading DB.xlsx`);
        const buf = await resp.arrayBuffer();
        const wb  = XLSX.read(buf, { type: "array" });

        const templatesTable = toAoA(wb, "Document Table");
        const variablesTable = toAoA(wb, "Variable Table");
        const clausesTable   = toAoA(wb, "Clause Table");
        const tagsTable      = toAoA(wb, "Tag Table");

        if (!templatesTable || !variablesTable || !clausesTable || !tagsTable) {
          throw new Error(
            'Required sheets missing — need "Document Table", "Variable Table", "Clause Table", and "Tag Table".'
          );
        }

        // EntryCategory is optional (we'll gracefully fall back to free text if missing)
        const { table: entryCategoriesTable, map } = parseEntryCategory(wb);
        setEntryOptionsMap(map);

        // Derive template names from Document Table
        const head = templatesTable[0] || [];
        const iName = findCol(head, "name") !== -1 ? findCol(head, "name") : 0;
        const names = templatesTable
          .slice(1)
          .map((r) => String(r[iName] ?? "").trim())
          .filter(Boolean);

        setTables({
          templatesTable,
          variablesTable,
          clausesTable,
          tagsTable,
          entryCategoriesTable, // raw AoA (may be null if sheet missing)
        });
        setTemplates(Array.from(new Set(names)));
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { loading, error, tables, templates, entryOptionsMap };
}
