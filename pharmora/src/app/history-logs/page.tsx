"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
} from "recharts";

/* ========= Config ========= */
const API_ROUTE = "/api/insulin-logs"; // Change to "/api/bolus" if that's your endpoint

/* ========= Types ========= */
type LogEntry = {
  datetime: string;       // ISO (UTC)
  type: string;           // "Basal" | "Rapid-Acting" | "Correction" | ...
  dose_units: number;
  site: string;
  note?: string;
};

type KPI = {
  total: number;
  avgPerDose: number;
  dosesPerDay: number;
  lastMinsAgo: string | number;
};

/* ========= Utils ========= */
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));
const dateOnly = (iso: string) => iso.slice(0, 10);
const minutesAgo = (iso?: string) => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 60000));
};

/* ========= Shared UI (icons + flyout) ========= */
function Icon({
  name,
  className = "w-5 h-5",
}: {
  name: "logo" | "menu" | "download" | "check";
  className?: string;
}) {
  const c = "stroke-current";
  if (name === "logo")
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M8 3v7M12 3v7m4-7v7M8 10c0 3 4 3 4 6v5M16 10c0 3-4 3-4 6" strokeWidth="1.5" />
      </svg>
    );
  if (name === "menu")
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M4 6h16M4 12h16M4 18h16" strokeWidth="1.5" />
      </svg>
    );
  if (name === "download")
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" strokeWidth="1.5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} ${c}`}>
      <path d="M20 6L9 17l-5-5" strokeWidth="1.8" />
    </svg>
  );
}

function MenuButton({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <button
      aria-label="Menu"
      onClick={toggle}
      className="relative h-11 w-11 rounded-2xl bg-white/5 ring-1 ring-white/10 text-slate-300 transition hover:ring-emerald-300/40 hover:bg-emerald-400/10 active:scale-95"
    >
      <span className={`absolute left-2.5 right-2.5 top-3 h-[2px] bg-current transition-transform duration-300 ${open ? "translate-y-2 rotate-45" : ""}`} />
      <span className={`absolute left-2.5 right-2.5 top-1/2 h-[2px] -translate-y-1/2 bg-current transition-opacity duration-300 ${open ? "opacity-0" : "opacity-100"}`} />
      <span className={`absolute left-2.5 right-2.5 bottom-3 h-[2px] bg-current transition-transform duration-300 ${open ? "-translate-y-2 -rotate-45" : ""}`} />
    </button>
  );
}

function Flyout({ open, close }: { open: boolean; close: () => void }) {
  const items = [
    { href: "/", label: "Dashboard" },
    { href: "/macro", label: "Insulin Estimator" },
    { href: "/history-logs", label: "History & Logs" }, // current page
    { href: "/forecast", label: "Glycemic Forecast" },
  ];
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={close}
      />
      <div
        className={`fixed right-6 top-16 z-40 w-[320px] origin-top-right rounded-3xl bg-gradient-to-br from-white/12 to-white/6 ring-1 ring-white/12 p-4 shadow-2xl transition-all ${open ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 -translate-y-2 pointer-events-none"}`}
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

/* ========= Tiny CSS heatmap (date × hour) ========= */
function HeatGrid({
  data,
  dates,
  hours,
}: {
  data: Record<string, number>; // key = `${date}|${hour}`
  dates: string[];
  hours: number[];
}) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid" style={{ gridTemplateColumns: `80px repeat(${hours.length}, 1fr)` }}>
          <div />
          {hours.map((h) => (
            <div key={h} className="px-2 py-1 text-center text-xs text-slate-400">{h}</div>
          ))}
          {dates.map((d) => (
            <div className="contents" key={d}>
              <div className="px-2 py-1 text-xs text-slate-400">{d}</div>
              {hours.map((h) => {
                const v = data[`${d}|${h}`] ?? 0;
                const alpha = v === 0 ? 0 : 0.12 + 0.88 * (v / max);
                return (
                  <div
                    key={h}
                    title={`${d} @ ${h}:00 — ${v}`}
                    className="m-[2px] h-6 rounded-md ring-1 ring-white/10"
                    style={{ backgroundColor: `rgba(16,185,129,${alpha})` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ========= Page ========= */
export default function HistoryLogsPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  // controls
  const [userId, setUserId] = useState<number>(100000);
  const [days, setDays] = useState<number>(7);

  // data + filters
  const [raw, setRaw] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selTypes, setSelTypes] = useState<string[]>([]);
  const [selSites, setSelSites] = useState<string[]>([]);
  const [dateMin, setDateMin] = useState<string>("");
  const [dateMax, setDateMax] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  // fetch logs
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_ROUTE}?user_id=${userId}&days=${days}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to fetch logs");
      const rows: LogEntry[] = (j?.logs ?? j) as LogEntry[];
      const clean = rows
        .filter(Boolean)
        .map((d) => ({ ...d, dose_units: Number(d.dose_units) }))
        .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
      setRaw(clean);
    } catch (e: any) {
      setError(e?.message || "Failed");
      setRaw([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // enrich
  const enriched = useMemo(
    () =>
      raw.map((r) => ({
        ...r,
        date: dateOnly(r.datetime),
        hour: new Date(r.datetime).getUTCHours(), // keep UTC (backend timestamp_utc)
      })),
    [raw]
  );

  // defaults
  useEffect(() => {
    const types = uniq(enriched.map((d) => d.type)).sort();
    const sites = uniq(enriched.map((d) => d.site)).sort();
    setSelTypes(types);
    setSelSites(sites);
    const dmin = enriched.length ? enriched[0].date : "";
    const dmax = enriched.length ? enriched[enriched.length - 1].date : "";
    setDateMin(dmin);
    setDateMax(dmax);
    setFrom(dmin);
    setTo(dmax);
  }, [enriched.length]); // only when dataset changes

  // filter
  const filtered = useMemo(
    () =>
      enriched.filter(
        (d) =>
          (selTypes.length === 0 || selTypes.includes(d.type)) &&
          (selSites.length === 0 || selSites.includes(d.site)) &&
          (!from || d.date >= from) &&
          (!to || d.date <= to)
      ),
    [enriched, selTypes, selSites, from, to]
  );

  // KPIs
  const kpi: KPI = useMemo(() => {
    const total = filtered.length;
    const avgPerDose = total ? +(filtered.reduce((s, r) => s + r.dose_units, 0) / total).toFixed(2) : 0;
    const uniqueDays = uniq(filtered.map((d) => d.date)).length || 1;
    const dosesPerDay = +(total / uniqueDays).toFixed(2);
    const last = filtered.length ? filtered[filtered.length - 1].datetime : undefined;
    return { total, avgPerDose, dosesPerDay, lastMinsAgo: minutesAgo(last) };
  }, [filtered]);

  // charts data
  const dailyStack = useMemo(() => {
    const by: Record<string, Record<string, number>> = {};
    filtered.forEach((d) => {
      by[d.date] = by[d.date] || {};
      by[d.date][d.type] = (by[d.date][d.type] || 0) + d.dose_units;
    });
    const typeKeys = uniq(filtered.map((d) => d.type)).sort();
    const rows = Object.entries(by)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, obj]) => ({ date, ...typeKeys.reduce((acc, t) => ({ ...acc, [t]: obj[t] || 0 }), {}) }));
    return { rows, typeKeys };
  }, [filtered]);

  const donut = useMemo(() => {
    const counts = filtered.reduce<Record<string, number>>((acc, d) => {
      acc[d.type] = (acc[d.type] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  const byHour = useMemo(() => {
    const total = filtered.length || 1;
    const types = uniq(filtered.map((d) => d.type)).sort();
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const rows = hours.map((h) => {
      const slice = filtered.filter((d) => d.hour === h);
      const perType: Record<string, number> = {};
      types.forEach((t) => {
        const ct = slice.filter((s) => s.type === t).length;
        perType[t] = +((ct / (slice.length || 1)) * 100).toFixed(2);
      });
      return { hour: h, ...perType };
    });
    return { rows, types };
  }, [filtered]);

  const heat = useMemo(() => {
    const map: Record<string, number> = {};
    const dates = uniq(filtered.map((d) => d.date)).sort();
    const hours = Array.from({ length: 24 }, (_, h) => h);
    filtered.forEach((d) => {
      const k = `${d.date}|${d.hour}`;
      map[k] = (map[k] || 0) + 1;
    });
    return { map, dates, hours };
  }, [filtered]);

  const avgBySite = useMemo(() => {
    const by: Record<string, { n: number; sum: number }> = {};
    filtered.forEach((d) => {
      by[d.site] = by[d.site] || { n: 0, sum: 0 };
      by[d.site].n += 1;
      by[d.site].sum += d.dose_units;
    });
    return Object.entries(by)
      .map(([site, s]) => ({ site, avg: +(s.sum / s.n).toFixed(2) }))
      .sort((a, b) => b.avg - a.avg);
  }, [filtered]);

  const typeIndex = useMemo(() => {
    const types = uniq(filtered.map((d) => d.type)).sort();
    const map = new Map(types.map((t, i) => [t, i + 1]));
    return { types, map };
  }, [filtered]);

  const scatterPoints = useMemo(
    () =>
      filtered.map((d, i) => ({
        x: typeIndex.map.get(d.type) || 0,
        y: d.dose_units,
        id: i,
        name: d.type,
      })),
    [filtered, typeIndex.map]
  );

  // CSV
  function downloadCSV() {
    const header = ["datetime", "type", "dose_units", "site", "note"];
    const rows = filtered.map((r) =>
      [r.datetime, r.type, r.dose_units, r.site, r.note ?? ""].map((x) => JSON.stringify(x ?? "")).join(",")
    );
    const blob = new Blob([header.join(",") + "\n" + rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "insulin_logs_filtered.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const [tab, setTab] = useState<"Overview" | "Timing" | "Sites" | "Data">("Overview");

  return (
    <main className="min-h-screen bg-[radial-gradient(1200px_600px_at_15%_-10%,rgba(16,185,129,0.09),transparent),radial-gradient(900px_500px_at_90%_-20%,rgba(59,130,246,0.07),transparent)] from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Top bar */}
      <div className="mx-auto max-w-7xl px-6">
        <header className="flex items-center gap-4 py-6">
          <span className="rounded-2xl bg-emerald-400/20 p-2.5 ring-1 ring-emerald-300/30">
            <Icon name="logo" className="h-6 w-6 text-emerald-300" />
          </span>
          <div className="mr-auto">
            <p className="text-sm text-slate-400">Explore</p>
            <h1 className="text-xl font-semibold tracking-tight">History & Logs</h1>
          </div>
          <MenuButton open={menuOpen} toggle={() => setMenuOpen((v) => !v)} />
          <Flyout open={menuOpen} close={() => setMenuOpen(false)} />
        </header>
      </div>

      {/* Content */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        {/* Controls */}
        <div className="rounded-3xl ring-1 ring-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-xl">
          <div className="grid grid-cols-12 gap-4">
            <label className="col-span-6 md:col-span-2 space-y-1">
              <span className="text-xs text-slate-400">User ID</span>
              <input
                type="number"
                value={userId}
                onChange={(e) => setUserId(Number(e.target.value))}
                className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-2.5 outline-none focus:ring-emerald-400/40"
              />
            </label>
            <label className="col-span-6 md:col-span-2 space-y-1">
              <span className="text-xs text-slate-400">Days to fetch</span>
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-2.5 outline-none focus:ring-emerald-400/40"
              />
            </label>

            {/* Types filter as chips */}
            <label className="col-span-12 md:col-span-4 space-y-1">
              <span className="text-xs text-slate-400">Insulin types</span>
              <div className="flex flex-wrap gap-2 rounded-xl ring-1 ring-white/10 bg-white/5 p-2">
                {uniq(enriched.map((d) => d.type))
                  .sort()
                  .map((t) => {
                    const active = selTypes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSelTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
                        className={`rounded-full px-3 py-1 text-xs ring-1 transition ${
                          active ? "bg-emerald-500 text-slate-950 ring-emerald-400" : "bg-white/0 text-slate-300 ring-white/15 hover:bg-white/5"
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
              </div>
            </label>

            {/* Sites filter as chips */}
            <label className="col-span-12 md:col-span-4 space-y-1">
              <span className="text-xs text-slate-400">Injection sites</span>
              <div className="flex flex-wrap gap-2 rounded-xl ring-1 ring-white/10 bg-white/5 p-2">
                {uniq(enriched.map((d) => d.site))
                  .sort()
                  .map((s) => {
                    const active = selSites.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSelSites((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                        className={`rounded-full px-3 py-1 text-xs ring-1 transition ${
                          active ? "bg-emerald-500 text-slate-950 ring-emerald-400" : "bg-white/0 text-slate-300 ring-white/15 hover:bg-white/5"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
              </div>
            </label>

            {/* Date range */}
            <label className="col-span-6 md:col-span-3 space-y-1">
              <span className="text-xs text-slate-400">From</span>
              <input
                type="date"
                min={dateMin}
                max={dateMax}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-2.5 outline-none focus:ring-emerald-400/40"
              />
            </label>
            <label className="col-span-6 md:col-span-3 space-y-1">
              <span className="text-xs text-slate-400">To</span>
              <input
                type="date"
                min={dateMin}
                max={dateMax}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-xl ring-1 ring-white/10 bg-white/5 p-2.5 outline-none focus:ring-emerald-400/40"
              />
            </label>

            <div className="col-span-12 flex items-end gap-3">
              <button
                onClick={load}
                type="button"
                className="rounded-2xl bg-emerald-500 px-5 py-2.5 text-slate-950 font-medium shadow-md transition hover:bg-emerald-400 active:scale-[.98]"
              >
                Refresh
              </button>
              <span className="text-xs text-slate-400">
                Showing last <b>{days}</b> day(s) for user <b>{userId}</b>. Filters are applied locally.
              </span>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-6 grid grid-cols-12 gap-6">
          {[
            { label: "Total doses", value: kpi.total },
            { label: "Avg units / dose", value: kpi.avgPerDose },
            { label: "Doses / day", value: kpi.dosesPerDay },
            { label: "Last dose (mins ago)", value: kpi.lastMinsAgo },
          ].map((k, i) => (
            <div key={i} className="col-span-12 md:col-span-3 rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
              <p className="text-xs text-slate-400">{k.label}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-8 flex flex-wrap gap-2">
          {(["Overview", "Timing", "Sites", "Data"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-2xl px-4 py-2 text-sm ring-1 transition ${
                  active ? "bg-emerald-500 text-slate-950 ring-emerald-400" : "bg-white/0 text-slate-300 ring-white/15 hover:bg-white/5"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="mt-4 space-y-6">
          {/* OVERVIEW */}
          {tab === "Overview" && (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-8 rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
                <p className="mb-3 text-sm text-slate-300">Daily total dose (stacked by type)</p>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyStack.rows}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#a8b3cf", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#a8b3cf", fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: "rgba(15,23,42,.95)", border: "1px solid rgba(255,255,255,.1)" }} />
                      <Legend wrapperStyle={{ color: "#cbd5e1" }} />
                      {dailyStack.typeKeys.map((k, i) => (
                        <Bar key={k} dataKey={k} stackId="a" radius={[4, 4, 0, 0]} fill={`hsl(${(i * 67) % 360} 80% 55% / .85)`} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-4 rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
                <p className="mb-3 text-sm text-slate-300">Dose events by type (count)</p>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="value" nameKey="name" innerRadius={60} outerRadius={110} paddingAngle={2}>
                        {donut.map((_, i) => (
                          <Cell key={i} fill={`hsl(${(i * 67) % 360} 80% 55% / .9)`} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "rgba(15,23,42,.95)", border: "1px solid rgba(255,255,255,.1)" }} />
                      <Legend wrapperStyle={{ color: "#cbd5e1" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* TIMING */}
          {tab === "Timing" && (
            <>
              <div className="rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
                <p className="mb-3 text-sm text-slate-300">Time-of-day distribution (percent within each hour bucket)</p>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byHour.rows}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: "#a8b3cf", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#a8b3cf", fontSize: 12 }} unit="%" />
                      <Tooltip contentStyle={{ background: "rgba(15,23,42,.95)", border: "1px solid rgba(255,255,255,.1)" }} />
                      <Legend wrapperStyle={{ color: "#cbd5e1" }} />
                      {byHour.types.map((t, i) => (
                        <Bar key={t} dataKey={t} radius={[4, 4, 0, 0]} fill={`hsl(${(i * 67) % 360} 80% 55% / .85)`} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
                <p className="mb-3 text-sm text-slate-300">Dose density by hour and date</p>
                <HeatGrid data={heat.map} dates={heat.dates} hours={heat.hours} />
              </div>
            </>
          )}

          {/* SITES */}
          {tab === "Sites" && (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-6 rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
                <p className="mb-3 text-sm text-slate-300">Average dose by site</p>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={avgBySite}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="site" tick={{ fill: "#a8b3cf", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#a8b3cf", fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: "rgba(15,23,42,.95)", border: "1px solid rgba(255,255,255,.1)" }} />
                      <Bar dataKey="avg" radius={[4, 4, 0, 0]} fill="hsl(160 84% 43% / .9)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-6 rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
                <p className="mb-3 text-sm text-slate-300">Dose distribution by type (strip)</p>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        allowDecimals={false}
                        tickFormatter={(v: number) => typeIndex.types[(v as number) - 1] || ""}
                        tick={{ fill: "#a8b3cf", fontSize: 12 }}
                        domain={[0, Math.max(1, typeIndex.types.length + 1)]}
                      />
                      <YAxis dataKey="y" name="Units" tick={{ fill: "#a8b3cf", fontSize: 12 }} />
                      <Tooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        contentStyle={{ background: "rgba(15,23,42,.95)", border: "1px solid rgba(255,255,255,.1)" }}
                        formatter={(value: number, _name: string, props: any): [string, string] => {
                          const t = typeIndex.types[(props?.payload?.x as number) - 1] || "";
                          return [`${value} U`, t];
                        }}
                      />
                      <Scatter data={scatterPoints} fill="hsl(210 90% 60% / .9)" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* DATA */}
          {tab === "Data" && (
            <div className="rounded-3xl ring-1 ring-white/10 bg-white/5 p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-slate-300">Filtered data ({filtered.length} rows)</p>
                <button
                  onClick={downloadCSV}
                  className="inline-flex items-center gap-2 rounded-2xl ring-1 ring-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:ring-emerald-300/40 hover:bg-emerald-400/10"
                >
                  <Icon name="download" /> Download CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-300">
                      <th className="px-3 py-2">Datetime (UTC)</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Units</th>
                      <th className="px-3 py-2">Site</th>
                      <th className="px-3 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr key={i} className="border-t border-white/10">
                        <td className="px-3 py-2 text-slate-300">{r.datetime}</td>
                        <td className="px-3 py-2">{r.type}</td>
                        <td className="px-3 py-2">{r.dose_units}</td>
                        <td className="px-3 py-2">{r.site}</td>
                        <td className="px-3 py-2 text-slate-300">{r.note || "—"}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                          No rows match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <p className="mt-10 text-center text-xs text-slate-400">
          This dashboard supports clinical reasoning. Always confirm with your clinician.
        </p>
      </section>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 backdrop-blur-sm">
          <div className="rounded-2xl ring-1 ring-white/20 bg-slate-900/80 px-5 py-4 text-slate-200 shadow-lg">
            <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            Loading…
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed inset-x-0 bottom-8 z-50 mx-auto w-fit transform rounded-full border border-rose-300/40 bg-rose-500/95 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {error}
        </div>
      )}
    </main>
  );
}
