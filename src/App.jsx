import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

/* =========================
   CONFIG (dev/prod safe)
   ========================= */
const IS_DEV = import.meta.env.DEV;

// In dev, always hit the Vite proxy prefix. In prod, set VITE_USAI_BASE (include /api/v1).
const API_BASE = IS_DEV ? "/usai" : (import.meta.env.VITE_USAI_BASE || "");

// Example model; override with VITE_USAI_MODEL if needed.
const MODEL_ID = import.meta.env.VITE_USAI_MODEL || "claude_3_haiku";

// Only keep the key in the browser if you’re ok with it (dev). For prod, put the key server-side.
const API_KEY = import.meta.env.VITE_USAI_API_KEY || "";

/** Join base + path safely (prevents //) */
function joinUrl(base, path) {
  const b = (base || "").replace(/\/+$/, "");
  const p = (path || "").startsWith("/") ? path : `/${path || ""}`;
  return `${b}${p}`;
}

/** Normalize for fuzzy header/tag matching */
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

export default function App() {
  // CSV
  const [csvText, setCsvText] = useState("");
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const fileInputRef = useRef(null);

  // Contract search
  const [contractNumber, setContractNumber] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);

  // Notes
  const [notes, setNotes] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  // Template scanning & mapping
  const [templateArrayBuffer, setTemplateArrayBuffer] = useState(null);
  const [templatePlaceholders, setTemplatePlaceholders] = useState([]); // ["Award Number", ...]
  const [mapping, setMapping] = useState({}); // { "Award Number": "Award Number", ... }
  const [scanning, setScanning] = useState(false);
  const [building, setBuilding] = useState(false);

  /* =========================
     CSV ingestion
     ========================= */
  async function autoLoadCsvFromPublic() {
    try {
      const res = await fetch("/sample-awards.csv");
      if (!res.ok) return; // silently skip if missing
      const txt = await res.text();
      setCsvText(txt);
    } catch {
      // ignore; user can paste or upload
    }
  }

  function handleCsvFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(f);
  }

  function parseCsv(text) {
    const seen = {};
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => {
        let key = String(h || "").trim();
        if (!key) return key;
        if (seen[key]) {
          seen[key] += 1;
          key = `${key}__${seen[key]}`; // suffix duplicate column names
        } else {
          seen[key] = 1;
        }
        return key;
      },
    });
    if (parsed.errors?.length) console.warn(parsed.errors);

    const data = (parsed.data || []).map((r) => {
      const clean = {};
      for (const [k, v] of Object.entries(r)) {
        clean[String(k).trim()] = typeof v === "string" ? v.trim() : v;
      }
      return clean;
    });

    setRows(data);
    setHeaders(parsed.meta?.fields || []);
  }

  useEffect(() => {
    if (csvText.trim()) parseCsv(csvText);
  }, [csvText]);

  useEffect(() => {
    autoLoadCsvFromPublic();
  }, []);

  /* =========================
     Contract search
     ========================= */
  const matchKeys = useMemo(
    () => [
      "Award Number",
      "Contract Number",
      "Base Award Number",
      "Schedule Other Base Award Number",
    ],
    []
  );

  function findRowByContract(contract) {
    if (!contract || !rows.length) return null;
    const needle = contract.trim().toLowerCase();
    // exact matches on common keys
    for (const key of matchKeys) {
      const hit = rows.find((r) => String(r[key] || "").toLowerCase() === needle);
      if (hit) return hit;
    }
    // contains on common keys
    for (const key of matchKeys) {
      const hit = rows.find((r) => String(r[key] || "").toLowerCase().includes(needle));
      if (hit) return hit;
    }
    // fallback: any column exact
    return (
      rows.find((r) =>
        Object.values(r).some((v) => String(v || "").toLowerCase() === needle)
      ) || null
    );
  }

  function handleSearch() {
    const row = findRowByContract(contractNumber);
    setSelectedRow(row);
    if (!row) alert("No match found. Double-check the contract/award number or load a different CSV.");
  }

  /* =========================
     Template scanning (no Docxtemplater)
     ========================= */
  async function fetchTemplate() {
    // NOTE: using your new filename
    const resp = await fetch("/template_patched.docx", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Template fetch failed: HTTP ${resp.status}`);
    return await resp.arrayBuffer();
  }

  function xmlToVisibleText(xml) {
    // normalize common break/tab tags
    xml = xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>|<w:cr\/>/g, "\n");
    // collect all <w:t> nodes; Word often splits words across runs
    const out = [];
    const reWT = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = reWT.exec(xml))) {
      const frag = m[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      out.push(frag);
    }
    return out.join("");
  }

  function extractPlaceholdersFromDocxBuffer(buf) {
    const zip = new PizZip(buf);
    const allNames = Object.keys(zip.files);

    // all XML under /word (document, headers, footers, footnotes, textboxes, etc.)
    const wordXmls = allNames.filter(
      (n) => n.startsWith("word/") && n.endsWith(".xml")
    );
    if (!wordXmls.length) {
      throw new Error("No XML parts found under /word in template_patched.docx");
    }

    let fullText = "";
    for (const name of wordXmls) {
      try {
        const file = zip.file(name);
        if (!file) continue;
        const xml = file.asText();
        const text = xmlToVisibleText(xml);
        fullText += text + "\n";
      } catch (e) {
        console.warn("[template scan] failed reading part:", name, e);
      }
    }

    // find {{ ... }} tokens
    const tags = new Set();
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    let mm;
    while ((mm = re.exec(fullText))) {
      const tag = mm[1].trim();
      if (tag) tags.add(tag);
    }

    return Array.from(tags);
  }

  function buildAutoMapping(tags, cols) {
    const normCols = cols.map((c) => ({ raw: c, normed: norm(c) }));
    const result = {};
    for (const t of tags) {
      const nt = norm(t);

      // special case: notes
      if (nt === "specialnotes" || nt === "notes") {
        result[t] = "__notes__";
        continue;
      }

      // exact normalized match
      let found = normCols.find((c) => c.normed === nt);
      if (found) {
        result[t] = found.raw;
        continue;
      }

      // heuristic contains / startswith
      found = normCols.find((c) => c.normed.includes(nt) || nt.includes(c.normed));
      if (found) {
        result[t] = found.raw;
        continue;
      }

      // default unmapped
      result[t] = "";
    }
    return result;
  }

  async function scanTemplate() {
    setScanning(true);
    try {
      const buf = await fetchTemplate();
      setTemplateArrayBuffer(buf);

      const tags = extractPlaceholdersFromDocxBuffer(buf);
      const sorted = tags.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );
      setTemplatePlaceholders(sorted);
      setMapping(buildAutoMapping(sorted, headers));

      if (!sorted.length) {
        alert(
          "No {{placeholders}} detected. Ensure braces are plain ASCII { } and tags are visible text (not content controls)."
        );
      }
    } catch (e) {
      console.error("[template scan] error:", e);
      alert(`Failed to scan template: ${e.message}. Check console for details.`);
    } finally {
      setScanning(false);
    }
  }

  function reAutoMap() {
    if (!templatePlaceholders.length) return;
    setMapping(buildAutoMapping(templatePlaceholders, headers));
  }

  function updateMapping(tag, value) {
    setMapping((prev) => ({ ...prev, [tag]: value }));
  }

  // If headers change after scanning, refresh automap
  useEffect(() => {
    if (templatePlaceholders.length && headers.length) {
      setMapping(buildAutoMapping(templatePlaceholders, headers));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers]);

  /* =========================
     USAi: quick connectivity test
     ========================= */
  async function testUsai() {
    try {
      const url = joinUrl(API_BASE, "/models");
      const r = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${API_KEY}` } });
      console.log("models status", r.status);
      const txt = await r.text(); // log raw text to see any HTML or error JSON
      console.log("models body", txt);
      if (!r.ok) alert(`Models request failed: HTTP ${r.status}`);
    } catch (e) {
      console.error("models error", e);
      alert(`Models request error: ${String(e)}`);
    }
  }

  /* =========================
     USAi: suggest notes
     ========================= */
  async function suggestNotes() {
    if (!selectedRow) return alert("Load CSV and select a matching contract first.");
    if (!API_KEY) return alert("Missing API key. Set VITE_USAI_API_KEY.");
    setSuggesting(true);
    try {
      const system =
        "You are an expert federal acquisition assistant. Given an award row, draft concise special notes to include in a template. The notes should: (1) highlight key dates (created/executed/end), (2) summarize key dollar amounts if present (Obligated, BAOV, MOL), (3) call out recurring service/LoGO/JWOD flags, (4) reference NAICS and award type if useful, (5) include vendor or region specifics, (6) keep it to 3–5 bullet points.";

      const url = joinUrl(API_BASE, "/chat/completions");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify({ type: "json", content: { contractNumber, row: selectedRow } }) },
          ],
          temperature: 0.3,
        }),
      });

      if (!res.ok) throw new Error(`USAi HTTP ${res.status}`);
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content?.trim?.() || "";
      setNotes(text);
    } catch (err) {
      console.error(err);
      alert(String(err));
    } finally {
      setSuggesting(false);
    }
  }

  /* =========================
     Template sanitizer & Docxtemplater render
     ========================= */
  function rebuildZipWith(fnModifyTextXml, buf) {
    const inZip = new PizZip(buf);
    const outZip = new PizZip();

    Object.keys(inZip.files).forEach((name) => {
      const file = inZip.file(name);
      if (!file) return;

      if (name.startsWith("word/") && name.endsWith(".xml")) {
        let xml = file.asText();

        // ---- SANITIZE: fix duplicated/adjacent braces ----
        // 1) Collapse any runs of { or } to exactly two ({{ or }})
        xml = xml.replace(/\{+/g, (m) => (m.length >= 2 ? "{{" : "{"));
        xml = xml.replace(/\}+/g, (m) => (m.length >= 2 ? "}}" : "}"));
        // 2) Ensure at least one space between a closing and next opening
        //    }}{{  ->  }} {{   (also catch when runs are split by whitespace)
        xml = xml.replace(/}}\s*{{/g, "}} {{");

        // ---- INTERNAL DELIMS: switch to [[ ]] to avoid brace collisions ----
        xml = xml.replace(/{{/g, "[[").replace(/}}/g, "]]").replace(/\]\]\s*\[\[/g, "]] [[");

        if (fnModifyTextXml) xml = fnModifyTextXml(xml, name) ?? xml;
        outZip.file(name, xml);
      } else {
        // binary or non-xml parts: copy as uint8array
        outZip.file(name, file.asUint8Array());
      }
    });

    return outZip.generate({ type: "arraybuffer" });
  }

  function prepareDocxForRender(originalArrayBuffer) {
    // Rebuild a sanitized copy of the docx (see above)
    return rebuildZipWith(null, originalArrayBuffer);
  }

  async function buildDocx() {
    if (!selectedRow) return alert("Select a row first.");
    if (!templateArrayBuffer) return alert("Scan the template first so we know which placeholders to fill.");

    // warn about unmapped
    const unmapped = templatePlaceholders.filter((t) => !mapping[t] && mapping[t] !== "__notes__");
    if (unmapped.length) {
      const proceed = confirm(
        `These placeholders are not mapped to CSV columns and will be left blank:\n- ${unmapped.join(
          "\n- "
        )}\n\nContinue?`
      );
      if (!proceed) return;
    }

    setBuilding(true);
    try {
      // 1) Sanitize/normalize the template XML (and swap to [[ ]] delimiters internally)
      const sanitized = prepareDocxForRender(templateArrayBuffer);

      // 2) Create Docxtemplater with [[ ]] delimiters
      const zip = new PizZip(sanitized);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "[[", end: "]]" },
      });

      // 3) Build context strictly from detected placeholders (names unchanged)
      const context = {};
      for (const tag of templatePlaceholders) {
        const src = mapping[tag];
        if (src === "__notes__") {
          context[tag] = notes || "";
        } else if (src && Object.prototype.hasOwnProperty.call(selectedRow, src)) {
          context[tag] = selectedRow[src] ?? "";
        } else {
          context[tag] = selectedRow?.[tag] ?? "";
        }
      }

      doc.setData(context);

      try {
        doc.render();
      } catch (e) {
        console.error("Docxtemplater render error (raw):", e);
        if (e.properties?.errors?.length) {
          const lines = e.properties.errors.map((err, i) => {
            const tag = err.properties?.tag ? ` (${err.properties.tag})` : "";
            return `${i + 1}. ${err.id || err.message}${tag}`;
          });
          alert(`Template rendering failed:\n\n${lines.join("\n")}`);
        } else {
          alert(`Template rendering failed: ${e.message || String(e)}`);
        }
        setBuilding(false);
        return;
      }

      const out = doc.getZip().generate({ type: "blob" });
      const name = `${selectedRow["Award Number"] || contractNumber || "document"}.docx`;
      saveAs(out, name);
    } catch (e) {
      console.error(e);
      alert("Unable to build the document. See console for details.");
    } finally {
      setBuilding(false);
    }
  }

  /* =========================
     UI
     ========================= */
  return (
    <div className="container">
      <h1 className="h1">USAi Template Filler</h1>
      <p className="p">
        Loads <code>/sample-awards.csv</code> automatically (if present) → enter contract # → scan <code>/template_patched.docx</code> to detect
        placeholders → (optional) USAi notes → download .docx
      </p>

      {/* 0) USAi quick test */}
      <section className="card">
        <h2>USAi connectivity</h2>
        <div className="row">
          <button className="btn btn-gray" onClick={testUsai}>Test USAi /models</button>
          <span className="small">Dev proxy base: <code>{API_BASE}</code> · Model: <code>{MODEL_ID}</code></span>
        </div>
      </section>

      {/* 1) CSV */}
      <section className="card">
        <h2>1) Data table</h2>
        <div className="row">
          <button
            className="btn btn-gray"
            onClick={async () => {
              try {
                const res = await fetch("/sample-awards.csv");
                if (!res.ok) throw new Error("Missing /sample-awards.csv");
                setCsvText(await res.text());
              } catch {
                setCsvText(exampleCsv);
              }
            }}
          >
            Reload /sample-awards.csv
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvFile} />
        </div>

        <div className="details">
          <div
            className="summary"
            onClick={(e) => {
              const d = e.currentTarget.nextElementSibling;
              if (d) d.style.display = d.style.display === "none" ? "block" : "none";
            }}
          >
            Or paste CSV
          </div>
          <div className="mt8" style={{ display: "none" }}>
            <textarea
              className="textarea"
              placeholder="Paste CSV with headers here"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
          </div>
        </div>

        {rows.length > 0 && (
          <p className="small mt12">
            Loaded <b>{rows.length}</b> rows · Columns: {headers.length}
          </p>
        )}
      </section>

      {/* 2) Contract search */}
      <section className="card">
        <h2>2) Enter Contract / Award Number</h2>
        <div className="row">
          <input
            className="input"
            placeholder="e.g., 47PA0123A0012"
            value={contractNumber}
            onChange={(e) => setContractNumber(e.target.value)}
          />
          <button className="btn btn-blue" onClick={handleSearch}>
            Find row
          </button>
        </div>

        {selectedRow && (
          <div className="mt12">
            <h3 style={{ margin: 0, fontWeight: 600 }}>Match found</h3>
            <div className="grid grid-2 mt8">
              {matchKeys.map((k) => (
                <div key={k} className="small">
                  <span className="k">{k}:</span>{" "}
                  <span className="v" style={{ fontWeight: 600 }}>{selectedRow[k] || "—"}</span>
                </div>
              ))}
            </div>

            <div className="details mt8">
              <div
                className="summary"
                onClick={(e) => {
                  const d = e.currentTarget.nextElementSibling;
                  if (d) d.style.display = d.style.display === "none" ? "block" : "none";
                }}
              >
                Show all fields
              </div>
              <div className="scroll mt8" style={{ display: "none" }}>
                {headers.map((h) => (
                  <div key={h} className="kv">
                    <div className="k">{h}</div>
                    <div className="v">{String(selectedRow[h] ?? "")}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3) Template scan & mapping */}
      <section className="card">
        <h2>3) Scan template & map fields</h2>
        <div className="row">
          <button className="btn btn-gray" disabled={scanning} onClick={scanTemplate}>
            {scanning ? "Scanning…" : "Scan /template_patched.docx"}
          </button>
          <button
            className="btn btn-gray"
            onClick={reAutoMap}
            disabled={!templatePlaceholders.length || !headers.length}
          >
            Auto-map to CSV headers
          </button>
          <span className="small">
            Template path: <code>/template_patched.docx</code>
          </span>
        </div>

        {templatePlaceholders.length > 0 ? (
          <div className="mt12">
            <p className="small">
              Detected placeholders:{" "}
              {templatePlaceholders.map((t) => (
                <code key={t} style={{ marginRight: 8 }}>
                  {`{{${t}}}`}
                </code>
              ))}
            </p>

            <div className="scroll mt8">
              {templatePlaceholders.map((t) => (
                <div key={t} className="kv">
                  <div className="k">
                    <code>{`{{${t}}}`}</code>
                  </div>
                  <div className="v">
                    <select
                      className="input"
                      value={mapping[t] ?? ""}
                      onChange={(e) => updateMapping(t, e.target.value)}
                    >
                      <option value="">— leave blank —</option>
                      <option value="__notes__">[Use Special Notes]</option>
                      {headers.includes(t) && <option value={t}>{t} (exact)</option>}
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <p className="small mt8">
              Tip: Map any tag to <code>[Use Special Notes]</code> to fill it from the notes box below.
            </p>
          </div>
        ) : (
          <p className="small mt8">No placeholders detected yet. Click “Scan /template_patched.docx”.</p>
        )}
      </section>

      {/* 4) Notes */}
      <section className="card">
        <h2>4) Special notes</h2>
        <div className="row">
          <button
            className="btn btn-indigo"
            disabled={suggesting}
            onClick={suggestNotes}
            title="USAi will draft 3–5 bullets using the row context"
          >
            {suggesting ? "Asking USAi…" : "Suggest via USAi"}
          </button>
          <span className="small">(Optional) Requires VITE_USAI_API_KEY</span>
        </div>
        <textarea
          className="textarea mt8"
          placeholder="Add clarifications, exceptions, funding notes, deliverables, etc."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      {/* 5) Build */}
      <section className="card">
        <h2>5) Build & download</h2>
        <p className="small">The template will be filled using the mapping above. Unmapped placeholders are left blank.</p>
        <button className="btn btn-emerald mt12" disabled={building} onClick={buildDocx}>
          {building ? "Building…" : "Download .docx"}
        </button>
      </section>

      <p className="small mt16">
        Tip: If Docxtemplater errors, check the console for a breakdown of each problematic tag and file offset.
      </p>
    </div>
  );
}

// Inline fallback sample (used if /sample-awards.csv is missing)
const exampleCsv = `Contracting Officer,Contracting Specialist,Contract Owner,Contracting Officer Representative,Budget Analyst,Supervisor,Program Manager,Contact - Requestor,Award Region Code,Award Number,Mod Number,Award Title,Obligation PDN,PR Number,AAC Code,NAICS,Category Code,Sub-Category,Award Type Code,Created Date,Executed Date,End Date,Closeout Date,Est. Ult. Completion Date,FE Building Code List,FE Program Code List,FE RWA List,FE Project Code List,FE Work Item List,FE Activity Code List,FE Sub Object Code List,Award Status,Is Recurring Service,Is LoGO,JWOD Provider (AbilityOne),Size Status,Subcontracting Plan,Combined Social Economic Factors,GFE GFP Description,Description of Requirement,Award Max Ordering Limit (MOL),Award Sum of DO Obligated Amount,PR Committed Amount,Award Obligated Amount,Award Base and All Options Value (BAOV),Variance - Pegasys Expended Amount - DO NOT USE FOR MIGRATIONS,Pegasys Accepted Amount - DO NOT USE FOR MIGRATIONS,Pegasys Outstanding Amount DO NOT USE FOR MIGRATIONS,Pegasys Open Amount - DO NOT USE FOR MIGRATIONS,PALT APM Plan ID,Vendor Name,UEI (SAM),SAM Government Business POC Email,SAM Electronic Business POC,Local Contact Email,Alternate Local Contact Email,Days in Draft or Days Expired or Days til Expiration,Closeout Exception Reason,Base Award Number,Schedule Other Base Award Number,Subcontracting Reporting Requirement
Jane Doe,Alex Smith,John Roe,Cameron Lee,Mary Chen,Sam Park,Dev Patel,Avery Quinn,11,47PA0123A0012,0,Janitorial Services FY25,PDN-123,PR-456,AAC-789,561720,CUST,General,FSS,2025-03-01,2025-04-15,2026-04-14,,2026-04-14,BLDG-1001,PGM-10,,PRJ-88,WI-22,ACT-5,SOC-1,Active,Yes,No,No,Small,Plan Required,8(a) + SDVOSB,,Routine custodial for Region 11 HQ,200000,150000,150000,150000,450000,0,0,0,0,APM-555,Acme Cleaners,ABCDEF123456,jane@acmecleaners.com,ops@acmecleaners.com,onsite@acmecleaners.com,,27,,47PA0123A0012,,Required`;



