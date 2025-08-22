// src/components/InferFromText.jsx
import React, { useState } from "react";
import { useAi } from "../modules/useAi";

export default function InferFromText({ templateName, onApplyTags, onApplyVariables }) {
  const { inferTags, extractVariables } = useAi();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState({ tags: [], vars: [] });

  const run = async () => {
    setBusy(true);
    try {
      const [tags, vars] = await Promise.all([
        inferTags({ text, templateName }),
        extractVariables({ text, templateName })
      ]);
      setFound({ tags, vars });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-content">
        <span className="card-title">Infer from Text</span>
        <div className="input-field">
          <textarea
            className="materialize-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste RFP or notes here…"
            rows={6}
          />
        </div>
        <button className={`btn ${busy ? "disabled" : ""}`} onClick={run}>
          {busy ? "Analyzing…" : "Analyze"}
        </button>

        {found.tags.length > 0 || found.vars.length > 0 ? (
          <>
            <ul className="collection with-header" style={{ marginTop: 16 }}>
              <li className="collection-header"><h6>Tag suggestions</h6></li>
              {found.tags.map((t, i) => (
                <li className="collection-item" key={`tag-sug-${t.tagId}-${i}`}>
                  <span className="title">Tag {t.tagId}</span>
                  <p>{t.answer} {t.confidence ? `· ${Math.round(t.confidence*100)}%` : ""}</p>
                </li>
              ))}
            </ul>

            <ul className="collection with-header">
              <li className="collection-header"><h6>Variable suggestions</h6></li>
              {found.vars.map((v, i) => (
                <li className="collection-item" key={`var-sug-${v.variableId}-${i}`}>
                  <span className="title">Var {v.variableId}</span>
                  <p>{v.value} {v.confidence ? `· ${Math.round(v.confidence*100)}%` : ""}</p>
                </li>
              ))}
            </ul>

            <div className="section" style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => onApplyTags?.(found.tags)}>Apply Tags</button>
              <button className="btn" onClick={() => onApplyVariables?.(found.vars)}>Apply Variables</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
