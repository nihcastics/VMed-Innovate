import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ---------------------- Tunables ---------------------- */
const LLM_PARSE_TIMEOUT_MS = 12_000;
const LLM_CHECK_TIMEOUT_MS = 6_000;
const RAG_ITEM_TIMEOUT_MS = 4_000;
const RAG_MAX_ITEMS = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** ---------------------- Schemas ---------------------- */
const ItemSchema = z.object({
  name: z.string(),
  qty: z.object({ amount: z.number(), unit: z.string() }),
  est_grams: z.number().positive(),
  conf_image: z.number().min(0).max(1),
  conf_text: z.number().min(0).max(1),
});

const ParseSchema = z.object({
  is_food_image: z.boolean(),
  match_score: z.number().min(0).max(1),
  items: z.array(ItemSchema).min(1),
  macros_llm: z.object({
    carbs_g: z.number().nonnegative(),
    protein_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    fiber_g: z.number().nonnegative().optional().default(0),
    calories_kcal: z.number().nonnegative().optional().default(0),
  }),
  notes: z.string().optional(),
});

const DoseParamsSchema = z.object({
  icr: z.number().positive().default(10),      // grams / U
  isf: z.number().positive().default(50),      // mg/dL per U
  target: z.number().positive().default(110),  // mg/dL
  bg: z.number().positive().optional(),
  iob: z.number().min(0).default(0),
  tdd: z.number().positive().default(40),
});

type Macros = { carbs_g: number; protein_g: number; fat_g: number; fiber_g?: number; calories_kcal?: number };

/** ---------------------- Helpers ---------------------- */
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r1 = (n: number | undefined) => Number((n ?? 0).toFixed(1));

function timeoutAfter(ms: number, label: string) {
  return new Promise<never>((_, rej) => setTimeout(() => rej(new Error(label)), ms));
}

async function fileToBase64(file: File) {
  const buf = Buffer.from(await file.arrayBuffer());
  return buf.toString("base64");
}

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { cache: "no-store", signal: controller.signal });
    return r;
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

/** OFF per-100g (timed) */
async function fetchOFFPer100gTimed(name: string, ms: number) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
    name
  )}&search_simple=1&json=1&page_size=1`;
  const r = await fetchWithTimeout(url, ms);
  if (!r || !r.ok) return null;
  const j = await r.json();
  const p = j?.products?.[0];
  if (!p || !p.nutriments) return null;

  const n = p.nutriments;
  const macros: Macros = {
    carbs_g: Number(n.carbohydrates_100g ?? n.carbs_100g ?? 0),
    protein_g: Number(n.proteins_100g ?? 0),
    fat_g: Number(n.fat_100g ?? 0),
    fiber_g: Number(n.fiber_100g ?? 0),
    calories_kcal: Number(n["energy-kcal_100g"] ?? n.energy_kcal_100g ?? (n.energy_100g ? Number(n.energy_100g) / 4.184 : 0)),
  };
  if ([macros.carbs_g, macros.protein_g, macros.fat_g, macros.fiber_g ?? 0].every(x => !x || x === 0)) return null;
  return macros;
}

/** Fuse LLM+RAG macros */
function fuseMacros(llm: Macros, rag: Macros | null, coverageWeight: number) {
  if (!rag) return llm;
  const wR = clamp(coverageWeight, 0, 1);
  const wL = 1 - wR;
  return {
    carbs_g: llm.carbs_g * wL + rag.carbs_g * wR,
    protein_g: llm.protein_g * wL + rag.protein_g * wR,
    fat_g: llm.fat_g * wL + rag.fat_g * wR,
    fiber_g: (llm.fiber_g ?? 0) * wL + (rag.fiber_g ?? 0) * wR,
    calories_kcal: (llm.calories_kcal ?? 0) * wL + (rag.calories_kcal ?? 0) * wR,
  };
}

/** Local dose */
function localDoseFromMacros(carbs_g: number, params: z.infer<typeof DoseParamsSchema>) {
  const meal = carbs_g / params.icr;
  const corr = params.bg && params.bg > params.target ? (params.bg - params.target) / params.isf : 0;
  const raw = meal + corr - params.iob;
  const capped = clamp(raw, 0, 0.2 * params.tdd);
  return { units: Math.round(capped * 10) / 10, meal, corr, raw };
}

/** LLM dose check (timeout) */
async function llmDoseCheck(genAI: GoogleGenerativeAI, carbs_g: number, params: z.infer<typeof DoseParamsSchema>) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200,
        responseMimeType: "application/json",
      },
    });

    const prompt = `
{
  "carbs_g": ${carbs_g},
  "ICR": ${params.icr},
  "ISF": ${params.isf},
  "target": ${params.target},
  "BG": ${params.bg ?? "null"},
  "IOB": ${params.iob},
  "TDD": ${params.tdd},
  "formula": "dose = carbs/ICR + max(0,(BG-target)/ISF) - IOB; cap to [0, 0.2*TDD]",
  "return": "JSON with { \\"dose_units\\": number }"
}`;

    const resp: any = await Promise.race([
      model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
      timeoutAfter(LLM_CHECK_TIMEOUT_MS, "LLM check timeout"),
    ]);

    // Gemini will return pure JSON due to responseMimeType
    const obj = JSON.parse(resp.response.text());
    const val = Number(obj.dose_units);
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/** Type guard for Promise.allSettled */
function isFulfilled<T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> {
  return r.status === "fulfilled";
}

/** Fallback JSON extractor if a model misbehaves (strip code fences, trailing commas) */
function safeParseJSON(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    // try to pull fenced block
    const fence = text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
    const raw = fence ? fence[1] : (text.match(/\\{[\\s\\S]*\\}/) || [])[0];
    if (!raw) throw new Error("No JSON found");
    const cleaned = raw.replace(/,\\s*([}\\]])/g, "$1"); // remove trailing commas
    return JSON.parse(cleaned);
  }
}

/** ---------------------- Route ---------------------- */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

    const form = await req.formData();
    const description = (form.get("description") as string) || "";
    const image = form.get("image") as File | null;

    const params = DoseParamsSchema.parse({
      icr: Number(form.get("icr") || 10),
      isf: Number(form.get("isf") || 50),
      target: Number(form.get("target") || 110),
      bg: form.get("bg") ? Number(form.get("bg")) : undefined,
      iob: Number(form.get("iob") || 0),
      tdd: Number(form.get("tdd") || 40),
    });

    // ---- LLM parse (enforce JSON + timeout) ----
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const parts: any[] = [{
      text: `
Return STRICT JSON ONLY with keys exactly as schema below.
{
  "is_food_image": boolean,
  "match_score": number,
  "items": [
    {"name": string, "qty":{"amount":number,"unit":string}, "est_grams": number,
     "conf_image": number, "conf_text": number}
  ],
  "macros_llm": {"carbs_g":number,"protein_g":number,"fat_g":number,"fiber_g":number,"calories_kcal":number},
  "notes": string
}
Meal description:
${description}
` }];

    if (image && image.size <= MAX_IMAGE_BYTES) {
      const base64 = await fileToBase64(image);
      parts.push({ inlineData: { data: base64, mimeType: image.type || "image/jpeg" } });
    }

    const parseModel = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 600,
        responseMimeType: "application/json",
      },
    });

    const parsedResp: any = await Promise.race([
      parseModel.generateContent({ contents: [{ role: "user", parts }] }),
      timeoutAfter(LLM_PARSE_TIMEOUT_MS, "LLM parse timeout"),
    ]);

    // Expect pure JSON; fallback if not
    const parsedJson = (() => {
      const t = parsedResp.response.text();
      try { return JSON.parse(t); } catch { return safeParseJSON(t); }
    })();

    const parsed = ParseSchema.parse(parsedJson);

    // ---- Non-disruptive warnings (kept minimal) ----
    const warnings: string[] = [];
    if (!parsed.is_food_image) warnings.push("The uploaded image does not look like food.");
    if (parsed.match_score < 0.6) warnings.push("Image and description do not match closely—please check.");

    // ---- RAG (parallel, capped, timed) ----
    const ranked = [...parsed.items]
      .sort((a, b) => (b.est_grams * (b.conf_image + b.conf_text)) - (a.est_grams * (a.conf_image + a.conf_text)))
      .slice(0, RAG_MAX_ITEMS);

    const ragResults = await Promise.allSettled(
      ranked.map((it) => fetchOFFPer100gTimed(it.name, RAG_ITEM_TIMEOUT_MS))
    );

    let ragTotals: Macros | null = { carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0, calories_kcal: 0 };
    let hits = 0;

    for (let i = 0; i < ragResults.length; i++) {
      const result = ragResults[i];
      if (!isFulfilled(result)) continue;
      const res = result.value;
      if (!res) continue;
      hits++;
      const grams = ranked[i].est_grams;
      ragTotals.carbs_g += (res.carbs_g ?? 0) * grams / 100;
      ragTotals.protein_g += (res.protein_g ?? 0) * grams / 100;
      ragTotals.fat_g += (res.fat_g ?? 0) * grams / 100;
      ragTotals.fiber_g = (ragTotals.fiber_g ?? 0) + (res.fiber_g ?? 0) * grams / 100;
      ragTotals.calories_kcal = (ragTotals.calories_kcal ?? 0) + (res.calories_kcal ?? 0) * grams / 100;
    }
    if (hits === 0) ragTotals = null;

    const coverage = ranked.length ? hits / ranked.length : 0;
    const ragWeight = clamp((coverage + parsed.match_score) / 2, 0, 1);
    const fused = fuseMacros(parsed.macros_llm, ragTotals, ragWeight);

    // ---- Dose (mutually validated, conservative) ----
    const local = localDoseFromMacros(fused.carbs_g, params);
    const llmUnits = await llmDoseCheck(genAI, fused.carbs_g, params);
    const finalUnits = Math.round(Math.min(local.units, llmUnits ?? local.units) * 10) / 10;

    const confidence = clamp(0.5 * parsed.match_score + 0.5 * coverage, 0, 1);

    const macrosOut = {
      carbs_g: r1(fused.carbs_g),
      protein_g: r1(fused.protein_g),
      fat_g: r1(fused.fat_g),
      fiber_g: r1(fused.fiber_g),
      calories_kcal: Math.round(fused.calories_kcal ?? 0),
      confidence,
    };

    const corrText =
      params.bg ? `${params.bg}→${params.target} mg/dL via ISF ${params.isf} ⇒ ${r1(local.corr)}U` : "no correction (BG not provided)";
    const capText = `capped at ≤ ${r1(0.2 * params.tdd)}U (20% of TDD)`;
    const rationale =
      `Meal: ${r1(fused.carbs_g)}g carbs ÷ ICR ${params.icr} ⇒ ${r1(local.meal)}U; ` +
      `Correction: ${corrText}; IOB: −${r1(params.iob)}U; ${capText}.`;

    return NextResponse.json({
      macros: macrosOut,
      dose: {
        units: finalUnits,
        rationale,
        disclaimer:
          "This suggestion is based on your ICR/ISF and estimated carbs. It is not medical advice. Confirm with your clinician.",
      },
      warnings, // no LLM/local disagreement disclosure
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message ?? "estimation failed" }, { status: 400 });
  }
}
