// src/components/VariablesPanel.jsx
import React, { useMemo } from "react";
import VariableField from "./VariableField";

/**
 * VariablesPanel
 *
 * Props:
 * - variables: array of variable objects (from getVariableInfo/filterAndSortVariables/addAnswersToFilteredVariables)
 * - answers: { [variableId:string]: string }
 * - onChange: (variableId, value) => void
 */
export default function VariablesPanel({ variables = [], answers = {}, onChange }) {
  const groups = useMemo(() => {
    const map = new Map();
    variables.forEach(v => {
      const key = v.Variable_Category || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    });
    return map;
  }, [variables]);

  const total = variables.length;
  const filled = variables.reduce((acc, v) => acc + (answers[String(v.Variable_ID)] ? 1 : 0), 0);
  const pct = total ? Math.round((filled / total) * 100) : 0;

  return (
    <div>
      <div className="section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h5 style={{ margin: 0 }}>Fill Document Variables</h5>
        <span className="new badge" data-badge-caption="% filled">{pct}</span>
      </div>

      {[...groups.entries()].map(([cat, list]) => (
        <div key={`cat-${cat}`} className="section">
          <h6 className="grey-text text-darken-2" style={{ marginTop: 0 }}>{cat}</h6>
          <div className="row">
            {list.map((v) => (
              <div key={`var-${v.Variable_ID}`} className="col s12">
                <VariableField
                  variable={v}
                  value={answers[String(v.Variable_ID)] || ""}
                  onChange={onChange}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
