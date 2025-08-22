/**
 * Heuristic "AI" for local dev:
 *  - Finds a $/number in text and uses it to set the first BAOV input tag (so BAOV rules evaluate).
 *  - For mutually-exclusive drop-down groups, matches Tag strings present in the text.
 *  - For Bool categories, tries to guess Yes/No from phrasing.
 *
 * Replace these with your real AI calls when ready.
 */

export function useAi() {
  async function inferTags({ text, tagsTable, templateName }) {
    if (!text || !tagsTable?.length) return [];

    const header = tagsTable[0];
    const idx = {
      Tag_ID: header.indexOf("Tag_ID"),
      Tag: header.indexOf("Tag"),
      Tag_Category: header.indexOf("Tag_Category"),
      Entry_Category: header.indexOf("Entry_Category"),
      Mutually_Exclusive: header.indexOf("Mutually_Exclusive"),
    };

    const rows = tagsTable.slice(1).map((r) => ({
      Tag_ID: r[idx.Tag_ID],
      Tag: String(r[idx.Tag] ?? ""),
      Tag_Category: String(r[idx.Tag_Category] ?? ""),
      Entry_Category: String(r[idx.Entry_Category] ?? ""),
      Mutually_Exclusive: r[idx.Mutually_Exclusive] === true || String(r[idx.Mutually_Exclusive]).toLowerCase() === "true",
    }));

    // Build groups by Entry_Category
    const byCategory = new Map();
    for (const row of rows) {
      if (!byCategory.has(row.Entry_Category)) byCategory.set(row.Entry_Category, []);
      byCategory.get(row.Entry_Category).push(row);
    }

    const suggestions = [];

    // 1) BAOV: Set amount on ANY single tag with Tag_Category including 'BAOV'
    const amount = findAmount(text);
    if (amount != null) {
      const baovTag = rows.find((r) => r.Tag_Category.includes("BAOV"));
      if (baovTag) {
        // For BAOV, the answer is the numeric string (the evaluator will set all thresholds)
        suggestions.push({ tagId: String(baovTag.Tag_ID), answer: String(amount) });
      }
    }

    // 2) Mutually-exclusive groups: if text includes one of the literal tag labels, pick it
    for (const [entryCat, list] of byCategory) {
      if (!list.some((l) => l.Mutually_Exclusive)) continue;

      // Sort to prefer longer tag labels (avoid partial matches)
      const sorted = [...list].sort((a, b) => b.Tag.length - a.Tag.length);
      const chosen = sorted.find((row) =>
        row.Tag && text.toLowerCase().includes(row.Tag.toLowerCase())
      );

      if (chosen) {
        // IMPORTANT: For mutually-exclusive evaluation, the evaluator only needs ONE tagId
        // in this Entry_Category with `answer === chosen.Tag`. It will mark the whole group.
        suggestions.push({ tagId: String(chosen.Tag_ID), answer: chosen.Tag });
      }
    }

    // 3) Bool categories: very light heuristics
    for (const [entryCat, list] of byCategory) {
      if (entryCat !== "Bool") continue;
      const any = list[0];
      if (!any) continue;

      const yes = /\b(yes|shall|will|required|must|true)\b/i.test(text);
      const no = /\b(no|not required|shall not|will not|won't|false)\b/i.test(text);

      if (yes && !no) {
        suggestions.push({ tagId: String(any.Tag_ID), answer: "Yes" });
      } else if (no && !yes) {
        suggestions.push({ tagId: String(any.Tag_ID), answer: "No" });
      }
    }

    // De-dup by tagId (keep first)
    const seen = new Set();
    return suggestions.filter((s) => (seen.has(s.tagId) ? false : (seen.add(s.tagId), true)));
  }

  // Stub for variable inference if you wire it up later
  async function inferVariables({ text, variablesTable }) {
    return []; // not used in current flow
  }

  return { inferTags, inferVariables };
}

/* ---------- helpers ---------- */
function findAmount(text) {
  // $12,345,678.90  or  12345678  or  12.3M / 12M
  const money = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|\d+)(?:\.\d+)?/;
  const m = text.match(money);
  if (m) {
    const cleaned = m[0].replace(/[^0-9.]/g, "");
    const n = parseFloat(cleaned);
    if (!isNaN(n)) return n;
  }
  // Try #.#M syntax
  const m2 = /(\d+(?:\.\d+)?)\s*m\b/i.exec(text);
  if (m2) {
    const n = parseFloat(m2[1]) * 1_000_000;
    if (!isNaN(n)) return n;
  }
  return null;
}
