// src/lib/docx.js
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

// Reuse [[ ]] delimiters internally to avoid brace collisions
export function sanitizeAndSwapDelimiters(ab) {
  const inZip = new PizZip(ab);
  const outZip = new PizZip();
  Object.keys(inZip.files).forEach((name) => {
    const f = inZip.file(name);
    if (!f) return;
    if (name.startsWith("word/") && name.endsWith(".xml")) {
      let xml = f.asText();
      xml = xml.replace(/\{+/g, (m) => (m.length >= 2 ? "{{" : "{"));
      xml = xml.replace(/\}+/g, (m) => (m.length >= 2 ? "}}" : "}"));
      xml = xml.replace(/}}\s*{{/g, "}} {{");
      xml = xml.replace(/{{/g, "[[").replace(/}}/g, "]]").replace(/\]\]\s*\[\[/g, "]] [[");
      outZip.file(name, xml);
    } else {
      outZip.file(name, f.asUint8Array());
    }
  });
  return outZip.generate({ type: "arraybuffer" });
}

// Parse visible text from Word XML to find {{tokens}}
function xmlVisibleText(xml) {
  const reWT = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m, out = [];
  while ((m = reWT.exec(xml))) {
    out.push(
      m[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    );
  }
  return out.join("");
}

export function scanPlaceholders(ab) {
  const zip = new PizZip(ab);
  const xmls = Object.keys(zip.files).filter((n) => n.startsWith("word/") && n.endsWith(".xml"));
  const found = new Set();
  for (const name of xmls) {
    try {
      const txt = xmlVisibleText(zip.file(name).asText());
      const re = /\{\{\s*([^}]+?)\s*\}\}/g;
      let mm;
      while ((mm = re.exec(txt))) found.add(mm[1].trim());
    } catch {}
  }
  return [...found];
}

/**
 * Build context: variables + clauses.
 * - variableTokens: Set of tokens that map to variable names
 * - clauseTokens:   Map token -> clause text (populate if included, else blank)
 */
export function makeContext({ variableAnswersByName, includedClausesByName, allTokens }) {
  const ctx = {};
  for (const tok of allTokens) {
    if (tok in (variableAnswersByName || {})) {
      ctx[tok] = variableAnswersByName[tok] ?? "";
    } else if (tok in (includedClausesByName || {})) {
      ctx[tok] = includedClausesByName[tok] ?? "";
    } else {
      // leave unmatched tokens blank
      ctx[tok] = "";
    }
  }
  return ctx;
}

export function renderAndDownload(ab, context, fileName = "document.docx") {
  const sanitized = sanitizeAndSwapDelimiters(ab);
  const zip = new PizZip(sanitized);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "[[", end: "]]" } });
  doc.setData(context);
  doc.render();
  const out = doc.getZip().generate({ type: "blob" });
  saveAs(out, fileName);
}
