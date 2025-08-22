import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDatabase } from "./modules/useDatabase";
import { useAi } from "./modules/useAi";
import Question from "./components/Question";
import VariableField from "./components/VariableField";

import {
  getTagsAndClausesByTemplateName,
  evaluateTagsBuildMode,
  evaluateClauses,
  returnNextTagQuestions,
  filterTableByIds,
  shapeTagsInfo,
  dedupeByTagId,
} from "./lib/evaluator";

/** Toggle: show questions even if Entry_Type is "No Display" */
const COERCE_NO_DISPLAY = true;

const SPLIT_RE = /[,|;]+/;
const asList = (cell) =>
  (cell == null ? [] : String(cell).split(SPLIT_RE).map((s) => s.trim()).filter(Boolean));

/** Build map: entryCategory(lowercased) -> options[] from EntryCategory Table */
function buildEntryOptionsMap(entryCategoriesTable) {
  if (!entryCategoriesTable?.length) return new Map();
  const head = entryCategoriesTable[0]?.map((h) => String(h || "").trim().toLowerCase()) || [];
  const iCat = head.findIndex((h) => ["category", "entry category", "name"].includes(h));
  const iOpts = head.findIndex((h) => ["options", "answers", "values", "option list"].includes(h));
  const map = new Map();
  for (const r of entryCategoriesTable.slice(1)) {
    const k = String(r[iCat] ?? "").trim().toLowerCase();
    const opts = asList(r[iOpts]);
    if (k) map.set(k, opts);
  }
  return map;
}

/** If a tag is No Display, make it renderable for UI (best-effort) */
function coerceForUI(tag, entryOptionsMap) {
  const t = { ...tag };
  const type = String(t.Entry_Type || "").toLowerCase();
  if (type !== "no display" || !COERCE_NO_DISPLAY) return t;

  const catKey = String(t.Entry_Category || "").trim().toLowerCase();
  const opts = entryOptionsMap.get(catKey) || [];

  // Prefer radio if Bool; else select if we have options; else text
  if (catKey === "bool") {
    t.Entry_Type = "Radio";
  } else if (opts.length > 0) {
    t.Entry_Type = "Drop Down";
  } else {
    t.Entry_Type = "Text";
  }
  t.__coerced = true;
  return t;
}

export default function App() {
  const { loading, error, tables, templates } = useDatabase();
  const ai = useAi();

  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [mode, setMode] = useState("build");
  const [answeredTags, setAnsweredTags] = useState({});
  const [answeredVariables, setAnsweredVariables] = useState({});

  const [resolverDebug, setResolverDebug] = useState([]);
  const [status, setStatus] = useState("idle");
  const [ratioCompleted, setRatioCompleted] = useState(0);

  const [nextQuestions, setNextQuestions] = useState([]);
  const [filteredTagsTable, setFilteredTagsTable] = useState([]);
  const [filteredClausesTable, setFilteredClausesTable] = useState([]);
  const [clausesArray, setClausesArray] = useState([]);
  const [tagsArray, setTagsArray] = useState([]);

  const [entryOptionsMap, setEntryOptionsMap] = useState(new Map());

  useEffect(() => {
    if (!loading) {
      setEntryOptionsMap(buildEntryOptionsMap(tables?.entryCategoriesTable));
    }
  }, [loading, tables]);

  const recompute = useCallback(
    (templateName, answers) => {
      if (!tables || !templateName) return;

      const { tagsArray, clausesArray, debug } = getTagsAndClausesByTemplateName(
        {
          templatesTable: tables.templatesTable,
          variablesTable: tables.variablesTable,
          clausesTable: tables.clausesTable,
        },
        templateName
      );

      setResolverDebug(debug || []);
      setTagsArray(tagsArray);
      setClausesArray(clausesArray);

      if (!clausesArray?.length) {
        setFilteredTagsTable([]);
        setFilteredClausesTable([]);
        setNextQuestions([]);
        setRatioCompleted(0);
        setStatus("empty-template");
        console.info("[recompute] empty template for", templateName);
        return;
      }

      const _filteredTags = filterTableByIds(tables.tagsTable, tagsArray);
      const _filteredClauses = filterTableByIds(tables.clausesTable, clausesArray);

      setFilteredTagsTable(_filteredTags);
      setFilteredClausesTable(_filteredClauses);

      // Shape & de-dup tags for UI
      const tagsInfoRaw = shapeTagsInfo(_filteredTags);
      const tagsInfo = dedupeByTagId(tagsInfoRaw);

      // Build-mode assignment
      const assigned = evaluateTagsBuildMode(answers, _filteredTags);

      // Clause evaluation
      const clauseEval = evaluateClauses(assigned, _filteredClauses);

      // Next questions
      const { status, nextQuestions, ratioCompletedTags } = returnNextTagQuestions(
        clauseEval,
        _filteredClauses,
        clausesArray,
        assigned,
        tagsArray,
        tagsInfo
      );

      setNextQuestions(nextQuestions);
      setRatioCompleted(ratioCompletedTags);
      setStatus(status);

      console.info("[recompute]", {
        templateName,
        clauses: clausesArray.length,
        tags: tagsArray.length,
        status,
        nextCount: nextQuestions.length,
      });
      // Helpful window hooks for quick inspection
      window.__dbgNext = nextQuestions;
      window.__dbgFilteredTags = _filteredTags;
      window.__dbgFilteredClauses = _filteredClauses;
    },
    [tables]
  );

  const handleTemplateChange = useCallback(
    (e) => {
      const name = e?.target?.value || "";
      setSelectedTemplate(name);
      setAnsweredTags({});
      setAnsweredVariables({});
      if (name) {
        recompute(name, {});
      } else {
        setStatus("idle");
        setNextQuestions([]);
        setRatioCompleted(0);
      }
    },
    [recompute]
  );

  const handleAnswer = useCallback(
    (tagId, answer) => {
      setAnsweredTags((prev) => {
        const updated = { ...prev, [String(tagId)]: answer ?? "" };
        if (selectedTemplate) recompute(selectedTemplate, updated);
        return updated;
      });
    },
    [recompute, selectedTemplate]
  );

  const [inferBlob, setInferBlob] = useState("");
  const [inferring, setInferring] = useState(false);
  const doInferFromText = useCallback(async () => {
    if (!inferBlob?.trim()) return;
    if (!filteredTagsTable?.length) return;

    setInferring(true);
    try {
      const tagsInfo = shapeTagsInfo(filteredTagsTable);
      const suggestions = await ai.inferTagsFromText(inferBlob, tagsInfo);
      setAnsweredTags((prev) => {
        const merged = { ...prev, ...suggestions };
        if (selectedTemplate) recompute(selectedTemplate, merged);
        return merged;
      });
    } catch (e) {
      console.error("Inference failed:", e);
    } finally {
      setInferring(false);
    }
  }, [ai, inferBlob, filteredTagsTable, recompute, selectedTemplate]);

  useEffect(() => {
    if (!loading && selectedTemplate) {
      recompute(selectedTemplate, answeredTags);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const templateOptions = useMemo(() => templates || [], [templates]);
  const progressPct = Math.round((ratioCompleted || 0) * 100);

  // Final UI de-dup + coercion
  const renderQuestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const q of nextQuestions || []) {
      const id = Number(q?.Tag_ID);
      if (!Number.isFinite(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(coerceForUI(q, entryOptionsMap));
    }
    return out;
  }, [nextQuestions, entryOptionsMap]);

  const hadOnlyNoDisplay =
    (nextQuestions?.length || 0) > 0 &&
    renderQuestions.length > 0 &&
    renderQuestions.every((q) => q.__coerced === true);

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <div className="row">
        <div className="col s12">
          <h4 className="header">USAI Template Filler</h4>
        </div>
      </div>

      {loading && (
        <div className="row">
          <div className="col s12">
            <div className="card-panel grey lighten-4">
              <span className="black-text">Loading DB.xlsx…</span>
            </div>
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="row">
          <div className="col s12">
            <div className="card-panel red lighten-4">
              <span className="red-text text-darken-4">
                Failed to load DB.xlsx — {String(error)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Template + Mode */}
      <div className="row">
        <div className="col s12 m8">
          <label>Choose a Template</label>
          <select
            className="browser-default"
            value={selectedTemplate}
            onChange={handleTemplateChange}
          >
            <option value="">— Select —</option>
            {templateOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="col s12 m4">
          <label>Mode</label>
          <select
            className="browser-default"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="build">Build Document</option>
            <option value="fill">Fill Document</option>
          </select>
        </div>
      </div>

      {/* Progress */}
      {selectedTemplate && (
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="col s12">
            <div className="grey lighten-3" style={{ height: 8, borderRadius: 4 }}>
              <div
                className="blue"
                style={{
                  width: `${progressPct}%`,
                  height: 8,
                  borderRadius: 4,
                }}
              />
            </div>
            <div className="right grey-text" style={{ marginTop: 4 }}>
              {progressPct}% complete
            </div>
          </div>
        </div>
      )}

      {/* Debug from resolver */}
      {resolverDebug?.length > 0 && (
        <div className="row">
          <div className="col s12">
            <details>
              <summary>Template resolver diagnostics</summary>
              <ul className="collection">
                {resolverDebug.map((d, i) => (
                  <li className="collection-item" key={`dbg-${i}`}>
                    {d}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}

      {/* Build mode */}
      {mode === "build" && selectedTemplate && (
        <>
          {status === "empty-template" && (
            <div className="row">
              <div className="col s12">
                <div className="card-panel red lighten-4">
                  <span className="red-text text-darken-4">
                    No questions available. This usually means the template’s{" "}
                    <b>Variable_Array</b> didn’t resolve to any Clause variables, or
                    those variables have blank <b>Associated_Clause_Array</b>, or the
                    associated clauses don’t reference any <b>Tags_Array</b>.
                  </span>
                </div>
              </div>
            </div>
          )}

          {status === "done" && (
            <div className="row">
              <div className="col s12">
                <div className="card-panel green lighten-4">
                  <span className="green-text text-darken-4">
                    No more questions — all clause conditions are resolved.
                  </span>
                </div>
              </div>
            </div>
          )}

          {status === "ask" && (
            <div className="row">
              <div className="col s12">
                {hadOnlyNoDisplay && (
                  <div className="card-panel amber lighten-4" style={{ marginBottom: 16 }}>
                    <span className="amber-text text-darken-4">
                      All unresolved tags are marked <b>No Display</b> in Tag Table. Showing them
                      here so you can progress. (Set <code>COERCE_NO_DISPLAY</code> = false to
                      hide these again.)
                    </span>
                  </div>
                )}

                <div className="card">
                  <div className="card-content">
                    <span className="card-title">Answer the next questions</span>

                    {renderQuestions.map((q) => {
                      const catKey = String(q.Entry_Category || "").trim().toLowerCase();
                      const opts = entryOptionsMap.get(catKey) || [];
                      return (
                        <Question
                          key={`q-${q.Tag_ID}`}
                          tagId={q.Tag_ID}
                          label={q.Question}
                          helper={q.Helper_Text}
                          entryType={q.Entry_Type}
                          entryCategory={q.Entry_Category}
                          value={answeredTags[String(q.Tag_ID)] ?? ""}
                          options={opts}
                          onChange={handleAnswer}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Infer from text */}
          {status !== "empty-template" && (
            <div className="row">
              <div className="col s12">
                <div className="card">
                  <div className="card-content">
                    <span className="card-title">Infer answers from pasted text</span>
                    <p className="grey-text" style={{ marginBottom: 12 }}>
                      Paste relevant scope/requirements text and let AI propose answers
                      to currently needed questions. You can still edit any answer.
                    </p>
                    <textarea
                      className="materialize-textarea"
                      value={inferBlob}
                      onChange={(e) => setInferBlob(e.target.value)}
                      placeholder="Paste project text or requirements here…"
                      style={{ minHeight: 120 }}
                    />
                  </div>
                  <div className="card-action">
                    <button
                      className={`btn ${inferring ? "disabled" : "blue"}`}
                      onClick={doInferFromText}
                      disabled={inferring || !inferBlob.trim()}
                    >
                      {inferring ? "Inferring…" : "Infer answers"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Fill mode (example) */}
      {mode === "fill" && selectedTemplate && (
        <div className="row">
          <div className="col s12">
            <div className="card">
              <div className="card-content">
                <span className="card-title">Fill document variables</span>
                <p className="grey-text" style={{ marginBottom: 16 }}>
                  This panel is for direct/indirect variables after the document is
                  built. Hook this to your variable resolver when ready.
                </p>
                <VariableField
                  key="v-8"
                  variableId={8}
                  label="Project Title"
                  helper="Shown on title page"
                  entryType="Text"
                  entryCategory=""
                  value={answeredVariables["8"] ?? ""}
                  onChange={(id, val) =>
                    setAnsweredVariables((p) => ({ ...p, [String(id)]: val }))
                  }
                />
              </div>
              <div className="card-action">
                <button className="btn blue">Fill Variables (Preview)</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating actions */}
      {selectedTemplate && (
        <div className="fixed-action-btn" style={{ bottom: 24, right: 24 }}>
          <a className="btn-floating btn-large blue">
            <i className="large material-icons">build</i>
          </a>
          <ul>
            <li>
              <a className="btn-floating green" title="Build document (preview only)">
                <i className="material-icons">description</i>
              </a>
            </li>
            <li>
              <a className="btn-floating orange" title="Explain clauses (console)">
                <i
                  className="material-icons"
                  onClick={() => {
                    console.info("[clauses]", filteredClausesTable);
                    console.info("[tags]", filteredTagsTable);
                    console.info("[next raw]", nextQuestions);
                    console.info(
                      "[next render ids]",
                      renderQuestions.map((q) => q.Tag_ID)
                    );
                  }}
                >
                  help
                </i>
              </a>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
