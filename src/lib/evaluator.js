// src/lib/evaluator.js

/** ---------- small helpers ---------- */
const SPLIT_RE = /[,|;]+/;

export const parseList = (cell) =>
  (cell == null ? [] : String(cell).split(SPLIT_RE).map((s) => s.trim()).filter(Boolean));

export const canon = (s) =>
  String(s || "").trim().replace(/\s+/g, " ").replace(/_/g, " ").toLowerCase();

export function findCol(headers, namePattern) {
  const rx = new RegExp(`^${namePattern}$`, "i");
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (rx.test(h)) return i;
  }
  return -1;
}

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const uniqNums = (arr) => Array.from(new Set(arr.map(Number))).filter(Number.isFinite);

/** ---------- common table helpers ---------- */
export function filterTableByIds(aoa, ids) {
  if (!aoa?.length) return [];
  if (!ids?.length) return [aoa[0]];
  const set = new Set(ids.map(Number));
  return [aoa[0], ...aoa.slice(1).filter((r) => set.has(Number(r[0])))];
}

/** Shape Tag rows the UI needs */
export function shapeTagsInfo(tagsAoA) {
  if (!tagsAoA?.length) return [];
  const head = tagsAoA[0];

  const iId = findCol(head, "tag\\s*id") === -1 ? 0 : findCol(head, "tag\\s*id");
  const iCat = findCol(head, "tag\\s*category");
  const iPri = findCol(head, "priority");
  const iQue = findCol(head, "question");
  const iType = findCol(head, "entry\\s*type");
  const iEC  = findCol(head, "entry\\s*category");
  const iHelp= findCol(head, "helper\\s*text");

  return tagsAoA.slice(1).map((r) => ({
    Tag_ID: toNum(r[iId]),
    Tag_Category: iCat !== -1 ? r[iCat] : "",
    Priority: iPri !== -1 ? Number(r[iPri] || Infinity) : Infinity,
    Question: iQue !== -1 ? r[iQue] : "",
    Entry_Type: iType !== -1 ? r[iType] : "Text",
    Entry_Category: iEC !== -1 ? r[iEC] : "",
    Helper_Text: iHelp !== -1 ? r[iHelp] : "",
  }));
}

/** De-duplicate shaped tags by Tag_ID (first occurrence wins) */
export function dedupeByTagId(arr) {
  const seen = new Set();
  const out = [];
  for (const t of arr || []) {
    const id = Number(t?.Tag_ID);
    if (!Number.isFinite(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

/** ---------- resolver: template -> clauses -> tags ---------- */
export function getTagsAndClausesByTemplateName(
  { templatesTable, variablesTable, clausesTable },
  templateName
) {
  const debug = [];
  if (!templatesTable?.length || !variablesTable?.length || !clausesTable?.length) {
    return { tagsArray: [], clausesArray: [], debug: ["One or more tables are empty."] };
  }

  // template row
  const tHead = templatesTable[0];
  const iTName = findCol(tHead, "name");
  const iTVar  = findCol(tHead, "variable\\s*array");
  const tRow = templatesTable.slice(1).find((r) => canon(r[iTName]) === canon(templateName));
  if (!tRow) {
    debug.push(`Template not found: ${templateName}`);
    return { tagsArray: [], clausesArray: [], debug };
  }

  const varList = parseList(tRow[iTVar]);
  if (!varList.length) {
    debug.push("Template Variable_Array is empty.");
    return { tagsArray: [], clausesArray: [], debug };
  }

  // map variables by Object_Name (and allow duplicates)
  const vHead = variablesTable[0];
  const iObj  = findCol(vHead, "object\\s*name");
  const iVType= findCol(vHead, "variable\\s*type");
  const iAssoc= findCol(vHead, "associated\\s*clause\\s*array");

  const clauseIds = [];
  const missingVars = [];

  for (const name of varList) {
    const matches = variablesTable
      .slice(1)
      .filter((r) => canon(r[iObj]) === canon(name) && canon(r[iVType]) === "clause");
    if (matches.length === 0) {
      missingVars.push(name);
      continue;
    }
    for (const r of matches) {
      const ids = uniqNums(parseList(r[iAssoc]));
      clauseIds.push(...ids);
    }
  }

  if (missingVars.length) debug.push(`Variables not found (or not type "Clause"): ${missingVars.join(", ")}`);

  const clausesArray = uniqNums(clauseIds).sort((a, b) => a - b);
  debug.push(`Resolved ${clausesArray.length} clause IDs from ${varList.length} variable names.`);

  // clauses -> tags
  const cHead = clausesTable[0];
  const iPc   = findCol(cHead, "pc\\s*id") === -1 ? 0 : findCol(cHead, "pc\\s*id");
  const iTags = findCol(cHead, "tags\\s*array");

  const tags = [];
  const clauseMap = new Map(clausesTable.slice(1).map((r) => [Number(r[iPc]), r]));
  for (const pc of clausesArray) {
    const row = clauseMap.get(pc);
    if (!row) continue;
    tags.push(...uniqNums(parseList(row[iTags])));
  }

  const tagsArray = uniqNums(tags).sort((a, b) => a - b);
  debug.push(`Collected ${tagsArray.length} unique tag IDs from clauses.`);

  return { tagsArray, clausesArray, debug };
}

/** ---------- evaluation: tags -> clauses ---------- */
export function evaluateTagsBuildMode(answeredTags, filteredTagsTable) {
  // very lightweight: -1/0/1 only for IDs we know about
  const out = {};
  if (!filteredTagsTable?.length) return out;

  const head = filteredTagsTable[0];
  const iId   = findCol(head, "tag\\s*id") === -1 ? 0 : findCol(head, "tag\\s*id");
  const iECat = findCol(head, "entry\\s*category");
  const iType = findCol(head, "entry\\s*type");

  // Index rows by Tag_ID for quick check
  const rowById = new Map(filteredTagsTable.slice(1).map((r) => [Number(r[iId]), r]));

  for (const [k, v] of Object.entries(answeredTags || {})) {
    const id = Number(k);
    if (!rowById.has(id)) continue;

    const row = rowById.get(id);
    const entryCat = canon(row[iECat]);
    const entryType = canon(row[iType]);

    if (entryCat === "bool") {
      const val = canon(v);
      out[id] = val === "yes" ? 1 : val === "no" ? -1 : 0;
    } else if (entryType === "no display") {
      // Treat any non-empty input as affirmative in build mode
      out[id] = String(v ?? "").trim() ? 1 : 0;
    } else {
      out[id] = String(v ?? "").trim() ? 1 : 0;
    }
  }

  // leave unknowns as 0/unset – they’ll drive next questions
  return out;
}

export function evaluateClauses(assignedTags, filteredClausesTable) {
  const result = {};
  if (!filteredClausesTable?.length) return result;

  const head = filteredClausesTable[0];
  const iPc   = findCol(head, "pc\\s*id") === -1 ? 0 : findCol(head, "pc\\s*id");
  const iInc  = findCol(head, "include\\s*if\\s*list");
  const iExc  = findCol(head, "exclude\\s*if\\s*list");

  const val = (tagId) => {
    const v = assignedTags?.[Number(tagId)];
    return v === 1 ? 1 : v === -1 ? -1 : 0;
  };

  for (const r of filteredClausesTable.slice(1)) {
    const pc = Number(r[iPc]);
    const inc = uniqNums(parseList(r[iInc]));
    const exc = uniqNums(parseList(r[iExc]));

    // any include == -1  -> fail
    if (inc.some((t) => val(t) === -1)) {
      result[pc] = -1;
      continue;
    }
    // any exclude == 1   -> fail
    if (exc.some((t) => val(t) === 1)) {
      result[pc] = -1;
      continue;
    }
    // all include == 1 AND all exclude == -1 -> include
    const incAllOne = inc.length === 0 ? true : inc.every((t) => val(t) === 1);
    const excAllNeg = exc.length === 0 ? true : exc.every((t) => val(t) === -1);

    result[pc] = incAllOne && excAllNeg ? 1 : 0;
  }

  return result;
}

/** ---------- next questions ---------- */
export function returnNextTagQuestions(
  clauseEval,
  filteredClausesTable,
  clausesArray,
  assignedTags,
  tagsArray,
  tagsInfo // shaped tag objects from filter table
) {
  const totalTags = (tagsArray?.length || 0);
  const assignedCount = Object.values(assignedTags || {}).filter((v) => v === 1 || v === -1).length;
  const ratioCompletedTags = totalTags > 0 ? assignedCount / totalTags : 0;

  const unresolvedClauses = (clausesArray || []).filter((pc) => clauseEval?.[pc] === 0);
  if (unresolvedClauses.length === 0) {
    return { status: "done", nextQuestions: [], ratioCompletedTags };
  }

  if (!filteredClausesTable?.length) {
    return { status: "ask", nextQuestions: [], ratioCompletedTags };
  }

  // map PC_ID -> Tags_Array
  const head = filteredClausesTable[0];
  const iPc   = findCol(head, "pc\\s*id") === -1 ? 0 : findCol(head, "pc\\s*id");
  const iTags = findCol(head, "tags\\s*array");

  const rowsByPc = new Map(filteredClausesTable.slice(1).map((r) => [Number(r[iPc]), r]));

  const unresolvedTagIds = [];
  for (const pc of unresolvedClauses) {
    const row = rowsByPc.get(pc);
    if (!row) continue;
    const tagIds = uniqNums(parseList(row[iTags]));
    unresolvedTagIds.push(...tagIds);
  }

  // keep only unresolved tags (unset or 0)
  const pendingTagIds = uniqNums(unresolvedTagIds).filter((tid) => {
    const v = assignedTags?.[tid];
    return v === undefined || v === 0;
  });

  if (pendingTagIds.length === 0) {
    // No tag left to ask, but clauses unresolved -> treat as done to avoid UI stall
    return { status: "done", nextQuestions: [], ratioCompletedTags };
  }

  // join with tagsInfo (fallback minimal objects if missing)
  const infoById = new Map((tagsInfo || []).map((t) => [Number(t.Tag_ID), t]));
  const nextInfo = [];
  for (const id of pendingTagIds) {
    const t = infoById.get(Number(id));
    if (t) {
      nextInfo.push(t);
    } else {
      nextInfo.push({ Tag_ID: id, Question: `Answer for Tag ${id}`, Entry_Type: "Text", Entry_Category: "", Helper_Text: "", Priority: Infinity, Tag_Category: "" });
    }
  }

  // de-dup defensively (should already be unique)
  const nextQuestions = dedupeByTagId(nextInfo)
    .sort((a, b) => (a.Priority ?? Infinity) - (b.Priority ?? Infinity) || a.Tag_ID - b.Tag_ID);

  return { status: "ask", nextQuestions, ratioCompletedTags };
}
