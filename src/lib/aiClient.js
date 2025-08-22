// src/lib/aiClient.js
const IS_DEV = import.meta.env.DEV;
const API_BASE = IS_DEV ? "/usai" : (import.meta.env.VITE_USAI_BASE || "");
const MODEL = import.meta.env.VITE_USAI_MODEL || "claude_3_haiku";
const KEY = import.meta.env.VITE_USAI_API_KEY || ""; // dev only; in prod, do a server proxy

function joinUrl(b,p){const B=(b||"").replace(/\/+$/,""); const P=p.startsWith("/")?p:`/${p}`; return `${B}${P}`;}

async function chatJSON({system, user, temperature=0.2, max_tokens=1200}) {
  const res = await fetch(joinUrl(API_BASE, "/chat/completions"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      max_tokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    })
  });
  if(!res.ok) throw new Error(`USAi HTTP ${res.status}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || "{}";
  // Be strict: ensure we only accept valid JSON
  try { return JSON.parse(text); }
  catch { throw new Error("AI did not return valid JSON"); }
}

export async function aiImproveQuestions({spec}) {
  const system = "You improve and order form questions. Return ONLY JSON per schema; no reasoning.";
  const user = {
    action: "improveQuestions",
    schema: {
      type:"object",
      properties:{questions:{type:"array",items:{
        type:"object",
        properties:{
          tagId:{type:"number"},
          question:{type:"string"},
          helper:{type:"string"},
          entryType:{enum:["Bool","Select","Text","Number"]},
          options:{type:"array",items:{type:"string"}}
        },required:["tagId","question","entryType"]
      }}},
      required:["questions"]
    },
    spec
  };
  return chatJSON({system, user});
}

export async function aiInferFromText({spec, text}) {
  const system = "Extract likely tag answers and variable values from text. Return ONLY JSON per schema.";
  const user = {
    action: "inferAnswers",
    schema: {
      type:"object",
      properties:{
        inferredTags:{type:"object", additionalProperties:{type:"string"}},
        inferredVariables:{type:"object", additionalProperties:{type:"string"}},
        confidence:{type:"object", additionalProperties:{type:"number"}}
      },
      required:["inferredTags","inferredVariables"]
    },
    spec, text
  };
  return chatJSON({system, user, temperature:0.1});
}

export async function aiExplainClause({clause, assignedTags}) {
  const system = "Explain inclusion/exclusion in one sentence. Return JSON: {\"explanation\":\"...\"}";
  const user = {clause, assignedTags};
  return chatJSON({system, user, max_tokens:300});
}
