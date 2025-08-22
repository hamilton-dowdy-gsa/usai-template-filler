import React, { useId } from "react";

/**
 * Generic Question component with proper Materialize markup.
 * Props:
 *  - tagId, label, helper, entryType, entryCategory, value, options[], onChange(id, val)
 */
export default function Question({
  tagId,
  label,
  helper,
  entryType,
  entryCategory,
  value,
  options = [],
  onChange,
}) {
  const type = String(entryType || "").toLowerCase();
  const uid = useId();
  const inputId = `tag-${tagId}-${uid}`;

  if (type === "no display") return null;

  const handleChange = (e) => onChange(tagId, e.target.value);

  // TEXT INPUT — Materialize expects input first, then label (floating)
  if (type === "text" || type === "input" || type === "") {
    return (
      <div className="input-field" style={{ marginBottom: 24 }}>
        <input
          id={inputId}
          type="text"
          className="validate"
          value={value ?? ""}
          onChange={handleChange}
          placeholder=""
          autoComplete="off"
        />
        {/* label after input; add 'active' when there's a value so it doesn't overlap */}
        <label htmlFor={inputId} className={value ? "active" : undefined}>
          {label}
        </label>
        {helper ? <span className="helper-text">{helper}</span> : null}
      </div>
    );
  }

  // DROPDOWN — use "browser-default" (not in .input-field)
  if (type === "drop down" || type === "dropdown" || type === "select") {
    const opts = options && options.length ? options : [];
    return (
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", marginBottom: 6 }}>{label}</label>
        <select className="browser-default" value={value ?? ""} onChange={handleChange}>
          <option value="">— Select —</option>
          {opts.map((opt, i) => (
            <option key={`${tagId}-opt-${i}`} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {helper ? <div className="grey-text" style={{ marginTop: 6 }}>{helper}</div> : null}
      </div>
    );
  }

  // RADIO — simple horizontal group
  if (type === "radio" || type === "bool") {
    const choices = options?.length ? options : ["Yes", "No"];
    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>{label}</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {choices.map((opt, i) => {
            const rid = `${inputId}-r-${i}`;
            return (
              <label key={rid} htmlFor={rid} style={{ cursor: "pointer" }}>
                <input
                  id={rid}
                  className="with-gap"
                  name={`tag-${tagId}`}
                  type="radio"
                  value={opt}
                  checked={String(value) === String(opt)}
                  onChange={handleChange}
                  style={{ marginRight: 6 }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
        {helper ? <div className="grey-text" style={{ marginTop: 6 }}>{helper}</div> : null}
      </div>
    );
  }

  // FALLBACK — treat as text
  return (
    <div className="input-field" style={{ marginBottom: 24 }}>
      <input
        id={inputId}
        type="text"
        className="validate"
        value={value ?? ""}
        onChange={handleChange}
        autoComplete="off"
      />
      <label htmlFor={inputId} className={value ? "active" : undefined}>
        {label}
      </label>
      {helper ? <span className="helper-text">{helper}</span> : null}
    </div>
  );
}
