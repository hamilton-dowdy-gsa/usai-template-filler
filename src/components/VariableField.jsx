import React from "react";

/**
 * Minimal variable field (text for now)
 * Props: variableId, label, helper, entryType, entryCategory, value, onChange(id,val)
 */
export default function VariableField({
  variableId,
  label,
  helper,
  entryType,
  entryCategory,
  value,
  onChange,
}) {
  const handle = (e) => onChange(variableId, e.target.value);
  return (
    <div className="input-field" style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>{label}</label>
      <input
        type="text"
        className="validate"
        value={value ?? ""}
        onChange={handle}
        placeholder={entryCategory || ""}
      />
      {helper ? <div className="grey-text" style={{ marginTop: 6 }}>{helper}</div> : null}
    </div>
  );
}
