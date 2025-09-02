"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

/* ---------------- Types ---------------- */
type Macros = {
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  fiber_g: number;
  calories_kcal: number;
  confidence: number;
};

type Dose = { units: number; rationale: string; disclaimer: string };

/* ---------------- Small UI helpers ---------------- */
function Icon({ name, className = "w-5 h-5" }: { name: "fork" | "photo" | "bolt" | "warning" | "copy" | "check" | "logo"; className?: string }) {
  const c = "stroke-current";
  if (name === "fork") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M8 3v7M12 3v7m4-7v7M8 10c0 3 4 3 4 6v5M16 10c0 3-4 3-4 6" strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "photo") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2-2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeWidth="1.5" />
        <path d="M8 14l2.5-2.5L13 14l3-3 3 3" strokeWidth="1.5" />
        <circle cx="8" cy="9" r="1.5" />
      </svg>
    );
  }
  if (name === "bolt") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8Z" strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "warning") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M12 3 2 20h20L12 3Z" strokeWidth="1.5" />
        <path d="M12 9v5m0 3.5h.01" strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "copy") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth="1.5" />
        <rect x="4" y="4" width="11" height="11" rx="2" strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M20 6L9 17l-5-5" strokeWidth="1.8" />
      </svg>
    );
  }
  // logo
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
      <path d="M8 3v7M12 3v7m4-7v7M8 10c0 3 4 3 4 6v5M16 10c0 3-4 3-4 6" strokeWidth="1.5" />
    </svg>
  );
}

function Field({
  label,
  val,
  set,
  step,
  allowEmpty,
  hint,
}: {
  label: string;
  val: number | string;
  set: (v: any) => void;
  step?: string;
  allowEmpty?: boolean;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-slate-300">{label}</span>
      <input
        type="number"
        step={step || "1"}
        className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-2.5 text-slate-100 placeholder-slate-400 shadow-sm outline-none focus:ring-emerald-400/40"
        value={val}
        onChange={(e) => set(allowEmpty && e.target.value === "" ? "" : Number(e.target.value))}
      />
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function StatBar({ label, value, max = 120 }: { label: string; value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="tabular-nums text-slate-300">{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/10">
        <div className="h-2 rounded-full bg-emerald-400/80" style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}

/* ---------------- Animated Hamburger + Flyout (same style as home) ---------------- */
function MenuButton({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <button
      aria-label="Menu"
      onClick={toggle}
      className="relative h-11 w-11 rounded-2xl bg-white/5 ring-1 ring-white/10 text-slate-300 transition hover:ring-emerald-300/40 hover:bg-emerald-400/10 active:scale-95"
    >
      <span
        className={`absolute left-2.5 right-2.5 top-3 h-[2px] bg-current transition-transform duration-300 ${
          open ? "translate-y-2 rotate-45" : ""
        }`}
      />
      <span
        className={`absolute left-2.5 right-2.5 top-1/2 h-[2px] -translate-y-1/2 bg-current transition-opacity duration-300 ${
          open ? "opacity-0" : "opacity-100"
        }`}
      />
      <span
        className={`absolute left-2.5 right-2.5 bottom-3 h-[2px] bg-current transition-transform duration-300 ${
          open ? "-translate-y-2 -rotate-45" : ""
        }`}
      />
    </button>
  );
}

function Flyout({ open, close }: { open: boolean; close: () => void }) {
  const items = [
    { href: "/", label: "Dashboard" },
    { href: "/macro", label: "Insulin Estimator" },
    { href: "/reminders", label: "Reminders" },
    { href: "/forecast", label: "Glycemic Forecast" },
  ];
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
      />
      <div
        className={`fixed right-6 top-16 z-40 w-[320px] origin-top-right rounded-3xl bg-gradient-to-br from-white/12 to-white/6 ring-1 ring-white/12 p-4 shadow-2xl transition-all ${
          open ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 -translate-y-2 pointer-events-none"
        }`}
      >
        <ul className="space-y-3">
          {items.map((it, i) => (
            <li
              key={it.href}
              style={{ transitionDelay: `${open ? i * 55 : 0}ms` }}
              className={`transition-transform ${open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
            >
              <Link
                onClick={close}
                href={it.href}
                className="block rounded-2xl px-4 py-3 text-lg text-slate-100 ring-1 ring-white/12 bg-white/6 hover:bg-emerald-400/15 hover:ring-emerald-300/40"
              >
                {it.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/* ---------------- Page ---------------- */
export default function MacroPage() {
  // form state
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [icr, setIcr] = useState(10);
  const [isf, setIsf] = useState(50);
  const [target, setTarget] = useState(110);
  const [bg, setBg] = useState<number | "">("");
  const [iob, setIob] = useState(0);
  const [tdd, setTdd] = useState(40);

  // ui state
  const [loading, setLoading] = useState(false);
  const [macros, setMacros] = useState<Macros | null>(null);
  const [dose, setDose] = useState<Dose | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const examples = [
    "2 chapatis, dal, 1 cup rice, chicken curry",
    "1 dosa with sambar and chutney",
    "Paneer wrap + small mango lassi",
  ];

  // image preview url
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const summary = useMemo(() => {
    if (!macros) return null;
    const totG = macros.carbs_g + macros.protein_g + macros.fat_g + macros.fiber_g;
    return { grams: totG, kcal: macros.calories_kcal, conf: Math.round(macros.confidence * 100) };
  }, [macros]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMacros(null);
    setDose(null);
    setWarnings([]);

    const fd = new FormData();
    fd.set("description", desc);
    if (file) fd.set("image", file);
    fd.set("icr", String(icr));
    fd.set("isf", String(isf));
    fd.set("target", String(target));
    if (bg !== "") fd.set("bg", String(bg));
    fd.set("iob", String(iob));
    fd.set("tdd", String(tdd));

    try {
      const r = await fetch("/api/macro", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Request failed");
      setMacros(j.macros);
      setDose(j.dose);
      setWarnings(j.warnings || []);
    } catch (err: any) {
      setError(err?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setDesc("");
    setFile(null);
    setMacros(null);
    setDose(null);
    setWarnings([]);
    setError(null);
  }

  async function copyResult() {
    if (!macros && !dose) return;
    const payload = JSON.stringify({ macros, dose, warnings }, null, 2);
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(1200px_600px_at_15%_-10%,rgba(16,185,129,0.09),transparent),radial-gradient(900px_500px_at_90%_-20%,rgba(59,130,246,0.07),transparent)] from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Top bar (shared look) */}
      <div className="mx-auto max-w-7xl px-6">
        <header className="flex items-center gap-4 py-6">
          <span className="rounded-2xl bg-emerald-400/20 p-2.5 ring-1 ring-emerald-300/30">
            <Icon name="logo" className="h-6 w-6 text-emerald-300" />
          </span>
          <div className="mr-auto">
            <p className="text-sm text-slate-400">Tool</p>
            <h1 className="text-xl font-semibold tracking-tight">Insulin Estimator</h1>
          </div>
          <MenuButton open={menuOpen} toggle={() => setMenuOpen((v) => !v)} />
          <Flyout open={menuOpen} close={() => setMenuOpen(false)} />
        </header>
      </div>

      {/* Content */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-8">
          {/* LEFT: Inputs */}
          <div className="col-span-12 lg:col-span-7 space-y-6">
            {/* Meal description + examples */}
            <div className="rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
              <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
                <Icon name="fork" /> Meal description
              </label>
              <textarea
                className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-3 text-slate-100 placeholder-slate-400 shadow-sm outline-none focus:ring-emerald-400/40"
                rows={3}
                placeholder="e.g., 2 chapatis, dal, 1 cup rice, chicken curry"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setDesc(ex)}
                    className="rounded-full ring-1 ring-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:ring-emerald-300/40 hover:bg-emerald-400/10"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            {/* Photo upload + preview */}
            <div className="rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
              <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
                <Icon name="photo" /> Optional: upload a photo
              </label>
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 md:col-span-7">
                  <input
                    type="file"
                    accept="image/*"
                    className="block w-full cursor-pointer rounded-xl border border-dashed border-white/15 bg-white/5 p-3 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500/90 file:px-3 file:py-1.5 file:text-slate-950 hover:border-emerald-300/40"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Image + text are both checked for agreement to avoid mismatches.
                  </p>
                </div>
                <div className="col-span-12 md:col-span-5">
                  <div className="aspect-video w-full overflow-hidden rounded-xl ring-1 ring-white/10 bg-white/5 grid place-items-center text-xs text-slate-400">
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="preview" className="h-full w-full object-cover" />
                    ) : (
                      "Preview"
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Params */}
            <div className="rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
              <h3 className="mb-4 text-base font-semibold">Your parameters</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="ICR (g/U)" val={icr} set={(v) => setIcr(v)} hint="Carb ratio" />
                <Field label="ISF (mg/dL/U)" val={isf} set={(v) => setIsf(v)} hint="Sensitivity" />
                <Field label="Target BG" val={target} set={(v) => setTarget(v)} />
                <Field label="Current BG" val={bg === "" ? "" : bg} set={(v) => setBg(v)} allowEmpty hint="Optional" />
                <Field label="IOB (U)" val={iob} set={(v) => setIob(v)} step="0.1" />
                <Field label="TDD cap (U)" val={tdd} set={(v) => setTdd(v)} hint="Cap = 20% of TDD" />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-2.5 font-medium text-slate-950 shadow-md transition hover:bg-emerald-400 disabled:opacity-60 active:scale-[.98]"
                >
                  <Icon name="bolt" className="h-5 w-5" />
                  {loading ? "Estimating…" : "Estimate & Suggest"}
                </button>
                <button
                  type="button"
                  onClick={resetAll}
                  className="rounded-2xl ring-1 ring-white/10 bg-white/0 px-4 py-2 text-sm text-slate-300 hover:ring-rose-300/40 hover:bg-rose-400/10"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={copyResult}
                  disabled={!macros && !dose}
                  className="inline-flex items-center gap-2 rounded-2xl ring-1 ring-white/10 bg-white/0 px-4 py-2 text-sm text-slate-300 hover:ring-emerald-300/40 hover:bg-emerald-400/10 disabled:opacity-50"
                >
                  <Icon name="copy" className="h-4 w-4" /> Copy result
                </button>
                <span className="ml-auto text-xs text-slate-400">
                  This tool supports clinical reasoning. Always confirm with your clinician.
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT: Results */}
          <div className="col-span-12 lg:col-span-5 space-y-6">
            {error && (
              <div className="rounded-2xl border border-rose-300/40 bg-rose-400/10 p-4 text-rose-200">
                Error: {error}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-2xl border border-amber-300/40 bg-amber-400/10 p-4 text-amber-200">
                <div className="mb-1 flex items-center gap-2 text-amber-200">
                  <Icon name="warning" /> Caution
                </div>
                <ul className="list-disc space-y-1 pl-5">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Dose card */}
            <div className="rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
              <h2 className="mb-1 text-lg font-semibold">Dose suggestion</h2>
              {dose ? (
                <>
                  <p className="text-4xl font-semibold tracking-tight">
                    ≈ <span className="text-emerald-300">{dose.units}</span> U
                  </p>
                  <p className="mt-3 text-sm text-slate-300">{dose.rationale}</p>
                  <p className="mt-3 text-xs italic text-slate-400">{dose.disclaimer}</p>
                </>
              ) : (
                <p className="text-sm text-slate-400">Run an estimation to see a conservative dose.</p>
              )}
            </div>

            {/* Macros card */}
            <div className="rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
              <h2 className="mb-3 text-lg font-semibold">Estimated macros</h2>
              {macros ? (
                <div className="grid gap-4">
                  <div className="grid gap-3">
                    <StatBar label="Carbs (g)" value={macros.carbs_g} />
                    <StatBar label="Protein (g)" value={macros.protein_g} />
                    <StatBar label="Fat (g)" value={macros.fat_g} />
                    <StatBar label="Fiber (g)" value={macros.fiber_g} />
                  </div>
                  <div className="rounded-xl ring-1 ring-white/10 bg-white/5 p-4">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-400">Calories</div>
                      <div className="text-right font-medium text-slate-100">{macros.calories_kcal} kcal</div>
                      <div className="text-slate-400">Confidence</div>
                      <div className="text-right font-medium text-slate-100">
                        {Math.round(macros.confidence * 100)}%
                      </div>
                      {summary && (
                        <>
                          <div className="text-slate-400">Total (g)</div>
                          <div className="text-right font-medium text-slate-100">{Math.round(summary.grams)}</div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Macros will appear here after estimation.</p>
              )}
            </div>
          </div>
        </form>

        {/* Copy toast */}
        <div
          className={`fixed inset-x-0 bottom-8 z-50 mx-auto w-fit transform rounded-full border border-emerald-300/40 bg-emerald-500/95 px-4 py-2 text-sm font-medium text-slate-950 shadow-lg transition-all duration-300 ${
            copied ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 pointer-events-none"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <span className="inline-grid place-items-center rounded-full bg-white/80 p-1">
              <Icon name="check" className="h-4 w-4 text-emerald-700" />
            </span>
            Copied!
          </span>
        </div>
      </section>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 backdrop-blur-sm">
          <div className="rounded-2xl ring-1 ring-white/20 bg-slate-900/80 px-5 py-4 text-slate-200 shadow-lg">
            <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            Estimating…
          </div>
        </div>
      )}
    </main>
  );
}
