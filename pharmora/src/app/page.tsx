"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/* ---------------- Types ---------------- */
type Injection = {
  insulin_type?: string;
  timestamp_utc: string; // ISO
  units_taken: number;
};

type GateState = "—" | "SAFE" | "CAUTION" | "WAIT";

/* ---------------- Config ---------------- */
const SAFETY_WINDOW_MIN = 180; // 3 hours

/* ---------------- Time helpers ---------------- */
function since(iso?: string) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "0m ago";
  const mins = Math.floor(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m ago` : `${m}m ago`;
}
function minsSince(iso?: string) {
  if (!iso) return Infinity;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 60000));
}

/* ---------------- Icons ---------------- */
function Icon({
  name,
  className = "w-5 h-5",
}: {
  name: "logo" | "bolt" | "bell" | "check" | "menu";
  className?: string;
}) {
  const c = "stroke-current";
  if (name === "logo") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M8 3v7M12 3v7m4-7v7M8 10c0 3 4 3 4 6v5M16 10c0 3-4 3-4 6" strokeWidth="1.5" />
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
  if (name === "bell") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" strokeWidth="1.5" />
        <path d="M10 18a2 2 0 0 0 4 0" strokeWidth="1.5" />
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
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
      <path d="M4 6h16M4 12h16M4 18h16" strokeWidth="1.5" />
    </svg>
  );
}

/* ---------------- Toast ---------------- */
function Toast({ show, text }: { show: boolean; text: string }) {
  return (
    <div
      className={`fixed inset-x-0 bottom-8 z-50 mx-auto w-fit transform rounded-full border border-emerald-300/40 bg-emerald-500/95 px-4 py-2 text-sm font-medium text-slate-950 shadow-lg transition-all duration-300 ${
        show ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 pointer-events-none"
      }`}
    >
      <span className="inline-flex items-center gap-2">
        <span className="inline-grid place-items-center rounded-full bg-white/80 p-1">
          <Icon name="check" className="h-4 w-4 text-emerald-700" />
        </span>
        {text}
      </span>
    </div>
  );
}

/* ---------------- Reminder Modal ---------------- */
function ReminderModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (iso: string) => void;
}) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  function preset(minutes: number) {
    const t = new Date(Date.now() + minutes * 60000);
    setDate(t.toISOString().slice(0, 10));
    setTime(t.toTimeString().slice(0, 5));
  }
  function save() {
    if (!time) return;
    const iso = new Date(`${date}T${time}:00`).toISOString();
    onSave(iso);
    onClose();
  }

  return (
    <div
      className={`fixed inset-0 z-40 grid place-items-center bg-slate-950/40 backdrop-blur-sm transition-opacity ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md transform rounded-2xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-5 text-slate-100 shadow-xl transition-all ${
          open ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Set a reminder</h3>
          <button onClick={onClose} className="rounded-lg ring-1 ring-white/10 px-2 py-1 text-slate-300">
            Close
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-slate-300">Date</span>
            <input
              type="date"
              className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-2 text-slate-100 outline-none focus:ring-emerald-300/50"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-300">Time</span>
            <input
              type="time"
              className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-2 text-slate-100 outline-none focus:ring-emerald-300/50"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-400">Quick presets</p>
          <div className="flex flex-wrap gap-2">
            {[30, 60, 120, 240].map((m) => (
              <button
                key={m}
                onClick={() => preset(m)}
                className="rounded-full ring-1 ring-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition hover:ring-emerald-300/40 hover:bg-emerald-400/10"
              >
                {m < 60 ? `${m} min` : `${m / 60} hr`}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl ring-1 ring-white/10 bg-white/0 px-3 py-2 text-sm text-slate-300 hover:ring-rose-300/40 hover:bg-rose-400/10"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-slate-950 shadow-md transition hover:bg-emerald-400 active:scale-[.98]"
          >
            <Icon name="bell" className="h-4 w-4 text-slate-950" />
            Save reminder
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Animated Hamburger + Big Flyout ---------------- */
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
  // ⬇️ Updated label for "/" to "History & Logs"
  const items = [
    { href: "/history-logs", label: "History & Logs" },
    { href: "/macro", label: "Insulin Estimator" },
    { href: "/reminders", label: "Reminders" },
    { href: "/forecast", label: "Glycemic Forecast" },
  ];
  return (
    <>
      {/* dimmer */}
      <div
        className={`fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
      />
      {/* panel */}
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

/* ---------------- Main Page ---------------- */
export default function HomePage() {
  const USER_NAME = "Sachin S";
  const USER_ID = 1;

  const [lastBolus, setLastBolus] = useState<Injection | null>(null);
  const [loading, setLoading] = useState(true);

  const [gate, setGate] = useState<GateState>("—");
  const [gateMsg, setGateMsg] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; text: string }>({ show: false, text: "" });

  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/bolus?user_id=${USER_ID}&window_hours=24`, { cache: "no-store" });
        const j = await r.json();
        setLastBolus((j?.lastBolus as Injection) ?? null);
      } catch {
        setLastBolus(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lastSince = useMemo(() => since(lastBolus?.timestamp_utc), [lastBolus]);
  const minutes = useMemo(() => minsSince(lastBolus?.timestamp_utc), [lastBolus]);

  function checkAboutToDose() {
    if (!lastBolus) {
      setGate("SAFE");
      setGateMsg("No prior bolus in the recent window. Safe to proceed.");
      return;
    }
    if (minutes >= SAFETY_WINDOW_MIN) {
      setGate("SAFE");
      setGateMsg(`Last dose was ${lastSince}. Safe window reached (≥ ${SAFETY_WINDOW_MIN / 60}h).`);
    } else if (minutes >= SAFETY_WINDOW_MIN * 0.5) {
      setGate("CAUTION");
      setGateMsg(`Last dose was ${lastSince}. Getting close to the safe window.`);
    } else {
      setGate("WAIT");
      setGateMsg(`Last dose was ${lastSince}. Too soon—avoid stacking.`);
    }
  }

  function takeDose() {
    // optimistic update; backend can persist later
    const now = new Date().toISOString();
    setLastBolus({ timestamp_utc: now, units_taken: 10, insulin_type: "aspart" });
    setGate("WAIT");
    setGateMsg("Dose recorded just now. Please avoid stacking for a while.");
    setToast({ show: true, text: "Dose updated" });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 1600);
  }

  function saveReminder(_iso: string) {
    setToast({ show: true, text: "Reminder set!" });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 1600);
  }

  const doseEnabled = gate === "SAFE";

  return (
    <main className="min-h-screen bg-[radial-gradient(1200px_600px_at_15%_-10%,rgba(16,185,129,0.09),transparent),radial-gradient(900px_500px_at_90%_-20%,rgba(59,130,246,0.07),transparent)] from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Top bar (aligned to content width) */}
      <div className="mx-auto max-w-7xl px-6">
        <header className="flex items-center gap-4 py-6">
          <span className="rounded-2xl bg-emerald-400/20 p-2.5 ring-1 ring-emerald-300/30">
            <Icon name="logo" className="h-6 w-6 text-emerald-300" />
          </span>
          <div className="mr-auto">
            <p className="text-sm text-slate-400">Hello</p>
            <h1 className="text-xl font-semibold tracking-tight">{USER_NAME}</h1>
          </div>
          <MenuButton open={menuOpen} toggle={() => setMenuOpen((v) => !v)} />
          <Flyout open={menuOpen} close={() => setMenuOpen(false)} />
        </header>
      </div>

      {/* Content */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="grid grid-cols-12 gap-8">
          {/* Left: Last shot */}
          <div className="col-span-12 lg:col-span-5 rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Last insulin shot</h2>
            <p className="mt-1 text-sm text-slate-400">Time since last bolus</p>

            <div className="mt-4 rounded-2xl bg-white/5 ring-1 ring-white/10 px-4 py-6 text-3xl font-semibold tracking-tight">
              {loading ? <div className="h-8 animate-pulse rounded bg-white/10" /> : lastBolus ? lastSince : "No Dose logged"}
            </div>

            <p className="mt-3 text-xs text-slate-400">Safety window: {SAFETY_WINDOW_MIN / 60} hours</p>
          </div>

          {/* Right: Actions */}
          <div className="col-span-12 lg:col-span-7 rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">About to dose?</h2>
                <p className="text-sm text-slate-400">Run a quick safety check and act.</p>
              </div>
              <button
                onClick={checkAboutToDose}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-2.5 text-base font-medium text-slate-950 shadow-md transition hover:bg-emerald-400 active:scale-[.98]"
              >
                <Icon name="bolt" className="h-5 w-5" />
                Check now
              </button>
            </div>

            <div className="mt-5 grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-4 rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                <p className="text-xs text-slate-400">Status</p>
                <p
                  className={`mt-1 text-xl font-semibold ${
                    gate === "SAFE"
                      ? "text-emerald-300"
                      : gate === "CAUTION"
                      ? "text-amber-300"
                      : gate === "WAIT"
                      ? "text-rose-300"
                      : "text-slate-200"
                  }`}
                >
                  {gate}
                </p>
              </div>

              <div className="col-span-12 md:col-span-8 rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                <p className="text-xs text-slate-400">Guidance</p>
                <p className="mt-1 text-sm">{gate === "—" ? "Tap Check now to evaluate stacking risk." : gateMsg}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setModalOpen(true)}
                className="group relative rounded-2xl ring-1 ring-white/10 bg-white/5 p-2.5 text-slate-300 transition hover:ring-emerald-300/40 hover:bg-emerald-400/10 active:scale-95"
                aria-label="Set reminder"
                title="Set reminder"
              >
                <span className="pointer-events-none absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 opacity-0 transition group-hover:opacity-100" />
                <Icon name="bell" className="h-5 w-5" />
              </button>

              <button
                disabled={!doseEnabled}
                onClick={takeDose}
                className={`relative rounded-2xl px-5 py-2.5 text-base font-medium shadow-md transition ${
                  doseEnabled
                    ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 active:scale-[.98]"
                    : "cursor-not-allowed ring-1 ring-white/10 bg-white/5 text-slate-400"
                }`}
              >
                {doseEnabled && (
                  <span className="pointer-events-none absolute inset-0 -z-10 rounded-2xl ring-2 ring-emerald-400/40 blur-[1.5px]" />
                )}
                Take dose
              </button>
            </div>
          </div>
        </div>

        <p className="mt-10 text-center text-xs text-slate-400">
          This dashboard supports clinical reasoning. Always confirm with your clinician.
        </p>
      </section>

      {/* Modal & Toast */}
      <ReminderModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={saveReminder} />
      <Toast show={toast.show} text={toast.text} />
    </main>
  );
}
