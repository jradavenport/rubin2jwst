// Has Rubin seen JWST? — static site. Reads the JSON products in <data>/<target>/.
import { skyMap, nightMap, distChart, STATUS, esc, deg, hhmm, TAI } from "./maps.js";

// ------------------------------------------------------------------------ config
const q = new URLSearchParams(location.search);
const DATA = (q.get("data") || "output").replace(/[^\w-]/g, "");   // ?data=demo for the demo folder
const MARKED = "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js";

// Navigation. To add a page: one line. A page that is just text needs only
// {id, label, c, md: "content/<file>.md"}; e.g. a notes page:
//   { id: "notes", label: "Notes", c: "var(--peach)", md: "content/notes.md" },
const PAGES = [
  { id: "status", label: "Latest", c: "var(--gold)", render: pageStatus },
  { id: "history", label: "History", c: "var(--jwst)", render: pageHistory },
  { id: "matches", label: "Matches", c: "var(--rubin)", render: pageMatches },
  { id: "about", label: "About", c: "var(--amber)", md: "content/about.md" },
];

// ------------------------------------------------------------------------ data
const cache = new Map();
async function get(path, { text = false } = {}) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return text ? r.text() : r.text().then(parse);
    }));
  }
  return cache.get(path);
}
// Rubin IDs exceed 2^53; keep them as strings so they survive JSON.parse.
const parse = (s) => JSON.parse(s.replace(/("(?:diaSourceId|diaObjectId)":\s*)(\d{16,})/g, '$1"$2"'));

let T, copy; // current target, editable copy
const base = () => `${DATA}/${T.slug}`;
const fill = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
const n0 = (x) => (x ?? 0).toLocaleString("en-US");

// ------------------------------------------------------------------- fragments
const pill = (status) => {
  const [bg, fg] = STATUS[status] || ["#444", "#fff"];
  return `<span class="pill" style="--c:${bg};color:${fg}">${esc(status)}</span>`;
};
function lastFinishedNight() { // same rule as jwst_alerts.py
  const d = new Date(Date.now() - 12 * 3600e3 - 864e5);
  return d.toISOString().slice(0, 10);
}
const nightTitle = (d) => {
  const t = new Date(d + "T12:00:00Z"), u = new Date(t.getTime() + 864e5);
  const s = (x) => x.toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `Rubin night ${d}: 12:00 UTC ${s(t)} → 12:00 UTC ${s(u)}`;
};

function readout(L) {
  const ln = L.last_night, stale = ln.dayobs < lastFinishedNight();
  const caught = ln.n_tight > 0;
  const m = caught && ln.matches.find((a) => a.tight);
  const v1 = caught ? `MATCH · ${m.time_utc.slice(11, 16)} UTC <span class="nc">${esc(m.band || "")}</span>` :
    ln.n_match ? "Candidate only · check by eye" : "No match";
  const lm = L.last_match;
  let h = `<a class="cell${caught ? " gold" : ""}" href="#/night/${ln.dayobs}" title="${esc(nightTitle(ln.dayobs))}. Checked ${esc(ln.checked_utc)}; each night is re-checked for 3 days.">` +
          `<span class="k">${stale ? "Latest checked night" : "Last night"} ${ln.dayobs}</span><span class="v">${v1}</span></a>`;
  h += lm ? `<a class="cell gold" href="#/night/${lm.dayobs}"><span class="k">Last match</span><span class="v">${lm.dayobs}</span></a>`
          : `<span class="cell"><span class="k">Last match</span><span class="v">Never</span></span>`;
  if (L.last_candidate && !caught)
    h += `<a class="cell" style="--c:var(--amber)" href="#/night/${L.last_candidate.dayobs}"><span class="k">Last loose candidate</span><span class="v">${L.last_candidate.dayobs}</span></a>`;
  return h;
}

function nightCard(r, { link = true } = {}) {
  const line = fill(copy.status_line[r.status] || "", { dist: r.nearest_alert_deg == null ? "" : (r.nearest_alert_deg < 1 ? r.nearest_alert_deg.toFixed(2) : r.nearest_alert_deg.toFixed(1)) });
  const sc = (STATUS[r.status] || ["#444"])[0];
  const mt = r.n_match ? `${r.n_tight}<span class="lbl"> / ${r.n_match}</span>` : "0";
  return `<div class="night-head"><span class="date" title="${esc(nightTitle(r.dayobs))}">${r.dayobs}</span>${pill(r.status)}</div>` +
    `<p class="line">${esc(line)}</p>` +
    `<div class="nums">` +
    `<div class="num" style="--c:var(--rubin)"><div class="v">${n0(r.n_new_objects)}</div><div class="k" title="${esc(copy.counts_note)}">New Lasair objects</div></div>` +
    `<div class="num" style="--c:${sc}"><div class="v">${deg(r.nearest_alert_deg)}</div><div class="k">Nearest alert</div></div>` +
    `<div class="num" style="--c:${r.n_tight ? "var(--gold)" : r.n_match ? "var(--amber)" : "var(--gray)"}"><div class="v">${mt}</div><div class="k">${r.n_match ? "Within 2″ / within 20″" : "Matches"}</div></div>` +
    `</div>` +
    (link ? `<a class="more" href="#/night/${r.dayobs}">Night details →</a>` : "");
}

const demoFlag = (meta) => (meta && meta.demo ? `<div class="demo-flag">${esc(meta.demo)}</div>` : "");

const matchTable = (rows, { night = false } = {}) => `<div class="tablewrap"><table><thead><tr>` +
  `<th>${night ? "" : "Night"}</th>` +
  `<th>UTC</th><th class="r">Sep</th><th>Band</th><th class="r">Mag</th><th class="r">S/N</th><th class="r">Rel.</th><th class="r">Trail</th><th>Visit · det</th><th>Lasair</th></tr></thead><tbody>` +
  rows.map((a) => {
    const t = a.time_utc ? a.time_utc.slice(11, 19) : hhmm(a.mjd_tai - TAI);
    return `<tr data-href="${esc(a.lasair_url)}"><td style="color:${a.tight ? "var(--teal-1)" : "var(--rubin)"}">${a.tight ? "★" : "○"}${night ? "" : ` ${a.dayobs}`}</td>` +
      `<td>${t}</td><td class="r">${a.sep_arcsec.toFixed(2)}″</td><td>${esc(a.band ?? "")}</td>` +
      `<td class="r">${a.mag != null ? a.mag.toFixed(2) : ""}</td><td class="r">${a.snr != null ? Number(a.snr).toFixed(1) : ""}</td>` +
      `<td class="r">${a.reliability != null ? Number(a.reliability).toFixed(2) : ""}</td><td class="r">${a.trailLength != null ? Number(a.trailLength).toFixed(1) + "″" : ""}</td>` +
      `<td>${esc(a.visit ?? "")} · ${esc(a.detector ?? "")}</td><td><a href="${esc(a.lasair_url)}" target="_blank" rel="noopener">${esc(a.diaObjectId)}</a></td></tr>`;
  }).join("") + `</tbody></table></div>`;

// ------------------------------------------------------------------------ pages
async function pageStatus() {
  const [L, sky] = await Promise.all([get(`${base()}/latest.json`), get(`${base()}/sky.json`)]);
  const ln = L.last_night;
  const which = ln.n_tight ? "last_night" : L.last_match ? "earlier" : "never";
  const sub = fill(copy.answer_sub[which], { n: n0(L.totals.nights_checked), date: which === "never" ? L.totals.first_night : L.last_match.dayobs });
  const cc = L.closest_call;
  let h = demoFlag(L.meta) +
    `<div class="answer${which === "last_night" ? " yes" : ""}">${esc(copy.answer[which])}</div><p class="sub">${esc(sub)}` +
    (cc && which === "never" ? ` Closest call: ${deg(cc.nearest_alert_deg)} on <a href="#/night/${cc.dayobs}">${cc.dayobs}</a>.` : "") + `</p>`;
  h += `<h2>${ln.dayobs < lastFinishedNight() ? "Latest checked night" : "Last night"}</h2>` + nightCard(ln);
  if (ln.n_in_boxes != null) {
    const full = await get(`${base()}/nights/${ln.dayobs}.json`);
    h += `<figure style="margin-top:1rem;max-width:40rem">${nightMap(full, { name: T.name })}</figure>`;
  }
  h += `<figure class="sky" style="margin-top:2.2rem">` +
    `<div class="toggle" role="group" aria-label="Time range">` +
    `<button type="button" data-sky="all">All history</button><button type="button" data-sky="recent">Last ${sky.days} days</button></div>` +
    `<div id="skymap"></div><div class="legend" id="skylegend"></div>` +
    `<figcaption>${esc(copy.sky_caption)}</figcaption></figure>`;
  return h;
}

// sky map range toggle; the choice is remembered per browser
let skyRange = (() => { try { return localStorage.getItem("skyRange") || "all"; } catch { return "all"; } })();
async function drawSky() {
  const box = document.getElementById("skymap");
  if (!box) return;
  const sky = await get(`${base()}/sky.json`), recent = skyRange === "recent";
  box.innerHTML = skyMap(sky, { name: T.name, recent });
  document.getElementById("skylegend").innerHTML =
    `<span><i class="sw line" style="--c:var(--gold)"></i>${esc(T.name)}, ${recent ? `last ${sky.days} days` : `since ${sky.start || sky.track[0].date}`}</span>` +
    `<span><i class="sw dash" style="--c:var(--gold)"></i>next ${sky.days} days</span>` +
    `<span><i class="sw" style="--c:var(--rubin)"></i>Rubin alerts, ${recent ? `last ${sky.days} nights` : "every night checked"}</span>` +
    `<span style="color:var(--teal-1)">★ detection</span>`;
  document.querySelectorAll("[data-sky]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sky === skyRange)));
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sky]");
  if (!b) return;
  skyRange = b.dataset.sky;
  try { localStorage.setItem("skyRange", skyRange); } catch { /* private mode: fine */ }
  pulse(); drawSky();
});

async function pageHistory() {
  const N = await get(`${base()}/nights.json`);
  const rows = N.nights;
  const withA = rows.filter((r) => r.nearest_alert_deg != null).length;
  let h = demoFlag(N.meta) + `<h2 style="margin-top:0">Distance from ${esc(T.name)} to the nearest new alert</h2>` +
    `<figure>${distChart(rows, { name: T.name, compact: innerWidth < 760 })}<figcaption>One dot per night with alerts (${withA} of ${rows.length} nights checked). ` +
    `Nights without alerts, or with ${esc(T.name)} below 20°, have no distance and are only in the table.</figcaption></figure>`;
  h += `<h2>Every night checked</h2><div class="downloads"><a class="btn ghost" href="${base()}/nights.csv" download>nights.csv</a><a class="btn ghost" href="${base()}/nights.json" download>nights.json</a></div>`;
  h += `<div class="tablewrap"><table><thead><tr><th>Night</th><th>Status</th><th class="r">New Lasair objects</th><th class="r">Nearest alert</th><th class="r">Matches</th></tr></thead><tbody>` +
    [...rows].reverse().map((r) => `<tr data-href="#/night/${r.dayobs}"><td>${r.dayobs}</td><td>${pill(r.status)}</td><td class="r">${n0(r.n_new_objects)}</td>` +
      `<td class="r">${deg(r.nearest_alert_deg)}</td><td class="r">${r.n_match ? `${r.n_tight} / ${r.n_match}` : ""}</td></tr>`).join("") +
    `</tbody></table></div>`;
  return h;
}

async function pageMatches() {
  const A = await get(`${base()}/alerts.json`);
  let h = demoFlag(A.meta) + `<h2 style="margin-top:0">Every Rubin alert matched to ${esc(T.name)}</h2>` +
    `<p class="note">One row per detection, oldest first in the files. ★ within 2″ (detection), ● 2–20″ (loose candidate, check by eye). ` +
    `Each night is re-checked for 3 days, so late alerts are added and nothing is duplicated.</p>` +
    `<div class="downloads"><a class="btn" href="${base()}/alerts.csv" download>alerts.csv</a><a class="btn ghost" href="${base()}/alerts.json" download>alerts.json</a></div>`;
  h += A.alerts.length ? matchTable([...A.alerts].reverse()) : `<p class="line">${esc(copy.alerts_empty)}</p>`;
  return h;
}

async function pageNight(d) {
  const [N, r] = await Promise.all([get(`${base()}/nights.json`), get(`${base()}/nights/${d}.json`)]);
  const i = N.nights.findIndex((x) => x.dayobs === d);
  const prev = N.nights[i - 1], next = N.nights[i + 1];
  let h = demoFlag(N.meta) + `<div class="pager"><a class="btn" style="--c:var(--jwst)" href="#/history">‹ History</a>` +
    (prev ? `<a class="btn ghost" href="#/night/${prev.dayobs}">‹ ${prev.dayobs}</a>` : "") +
    (next ? `<a class="btn ghost" href="#/night/${next.dayobs}">${next.dayobs} ›</a>` : "") + `</div>`;
  h += nightCard(r, { link: false });
  const tr = r.track || {}, up = tr.ra && tr.ra.length;
  const map = up && r.footprint && r.footprint.length ? nightMap(r, { name: T.name }) : "";   // no alerts = no map
  if (map) {
    const covered = r.n_in_boxes != null;
    h += `<figure style="margin-top:1.2rem;max-width:44rem">${map}<div class="legend">` +
      `<span><i class="sw line" style="--c:var(--gold)"></i>${esc(T.name)}'s track, seen from Rubin (Sun down, alt &gt; 20°)</span>` +
      (covered ? `<span style="color:var(--teal-1)">★ alert &lt; 2″</span><span style="color:var(--rubin)">○ alert 2–20″</span>`
               : `<span><i class="sw" style="--c:var(--rubin)"></i>new Lasair objects per 1° cell</span><span><i class="sw dash" style="--c:var(--rubin)"></i>to the nearest alert</span>`) +
      `</div><figcaption>${covered ? `Zoomed on ${esc(T.name)}'s track. ${n0(r.n_in_boxes)} objects in the search boxes along it. Click a match to open it in Lasair.`
        : "Brighter = more new objects in the cell. Hover a cell for its count."}</figcaption></figure>`;
  } else if (up) {
    const i = tr.ra.length >> 1, sgn = tr.dec[i] >= 0 ? "+" : "";
    h += `<p class="note">No map: Rubin sent no new alerts this night. ${esc(T.name)} was at RA ${tr.ra[i].toFixed(1)}°, ` +
      `Dec ${sgn}${tr.dec[i].toFixed(1)}°, above 20° from ${hhmm(tr.mjd_utc[0])} to ${hhmm(tr.mjd_utc[tr.ra.length - 1])} UTC.</p>`;
  } else if (r.status === "JWST not up") {
    h += `<p class="note">${esc(T.name)} never rose above 20° while the Sun was down, so there is no map for this night.</p>`;
  }
  if (r.matches.length) h += `<h2>Matches</h2>` + matchTable(r.matches.map((m) => ({ ...m, dayobs: d })), { night: true });
  h += `<p class="note" style="margin-top:1.5rem"><a href="${base()}/nights/${d}.json">Raw JSON for this night</a> · checked ${esc(r.checked_utc)}</p>`;
  return h;
}

async function pageMarkdown(p) {
  const [md] = await Promise.all([get(p.md, { text: true }), loadScript(MARKED)]);
  return `<div class="prose">${window.marked.parse(md)}</div>`;
}
function loadScript(src) {
  if (!cache.has(src)) cache.set(src, new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s);
  }));
  return cache.get(src);
}

// ------------------------------------------------------------------------ router
const lights = document.querySelector(".lights");
function pulse() {
  lights.classList.remove("sweep"); void lights.offsetWidth; lights.classList.add("sweep");
}
async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [id, arg] = h.split("/");
  const night = id === "night" && /^\d{4}-\d{2}-\d{2}$/.test(arg || "") ? arg : null;
  const page = PAGES.find((p) => p.id === id) || (night ? null : PAGES[0]);
  const navId = page ? page.id : "history";   // a night page sits under History
  document.querySelectorAll(".navbtn").forEach((a) => (a.dataset.id === navId ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.getElementById("readout").hidden = page !== PAGES[0];   // last night / last match: Latest page only
  const el = document.getElementById("page");
  lights.classList.add("loading");
  try {
    el.innerHTML = night ? await pageNight(night) : page.md ? await pageMarkdown(page) : await page.render();
    await drawSky();
    document.title = night ? `${night} · ${copy.title}` : page === PAGES[0] ? copy.title : `${page.label} · ${copy.title}`;
  } catch (e) {
    el.innerHTML = `<p class="line">Couldn't load this page.</p><p class="note">${esc(e.message)}</p>`;
  } finally {
    lights.classList.remove("loading");
  }
  hideTip();
  if (!location.hash || id !== "night") window.scrollTo(0, 0);
}

// ------------------------------------------------------------------------ tooltip
const tip = document.getElementById("tip");
let pointer = "mouse", pinnedEl = null;
function showTip(el, x, y, pinned = false) {
  const href = el.dataset.href;
  tip.innerHTML = el.dataset.tip + (pinned && href ? `<br><a class="btn" href="${esc(href)}"${href.startsWith("#") ? "" : ' target="_blank" rel="noopener"'}>${href.startsWith("#") ? "Open night" : "Open in Lasair"}</a>` : "");
  tip.style.setProperty("--c", el.dataset.c || "");
  tip.hidden = false; tip.classList.toggle("pinned", pinned);
  const r = tip.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  tip.style.left = `${Math.max(8, Math.min(x + 14, vw - r.width - 8))}px`;
  tip.style.top = `${y + 16 + r.height > vh ? Math.max(8, y - r.height - 12) : y + 16}px`;
  pinnedEl = pinned ? el : null;
}
function hideTip() { tip.hidden = true; pinnedEl = null; }
function go(href) {
  pulse();
  if (href.startsWith("#")) location.hash = href; else window.open(href, "_blank", "noopener");
}
document.addEventListener("pointerdown", (e) => { pointer = e.pointerType; });
document.addEventListener("pointerover", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (el && e.pointerType === "mouse") showTip(el, e.clientX, e.clientY);
});
document.addEventListener("pointermove", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (el && e.pointerType === "mouse" && !pinnedEl) showTip(el, e.clientX, e.clientY);
});
document.addEventListener("pointerout", (e) => {
  if (e.pointerType === "mouse" && e.target.closest?.("[data-tip]") && !pinnedEl) hideTip();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("a")) { pulse(); if (e.target.closest(".tip")) hideTip(); return; }
  const el = e.target.closest("[data-tip], tr[data-href]");
  if (!el) { if (!e.target.closest(".tip")) hideTip(); return; }
  if (el.dataset.tip && pointer !== "mouse" && pinnedEl !== el) {   // touch: first tap explains, button opens
    const r = el.getBoundingClientRect();
    showTip(el, r.left + r.width / 2, r.top + r.height / 2, true);
    return;
  }
  if (el.dataset.href) go(el.dataset.href);
});
document.addEventListener("keydown", (e) => {
  const el = e.target.closest?.("[data-href]");
  if (e.key === "Enter" && el && !el.matches("a")) go(el.dataset.href);
  if (e.key === "Escape") hideTip();
});
document.addEventListener("focusin", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (el) { const r = el.getBoundingClientRect(); showTip(el, r.right, r.top); }
});

// ------------------------------------------------------------------------ start
(async function start() {
  lights.classList.add("loading");
  try {
    const [targets, c] = await Promise.all([get(`${DATA}/targets.json`), get("content/copy.json")]);
    copy = c;
    const list = targets.targets;
    T = list.find((t) => t.slug === q.get("t")) || list[0];
  } catch (e) {
    document.getElementById("page").innerHTML = `<p class="line">No data yet.</p><p class="note">${esc(e.message)}</p>`;
    lights.classList.remove("loading");
    return;
  }
  document.querySelector(".side").innerHTML =
    PAGES.map((p) => `<a class="navbtn" data-id="${p.id}" href="#/${p.id === PAGES[0].id ? "" : p.id}" style="--c:${p.c}">${esc(p.label)}</a>`).join("") +
    `<div class="fill"></div><div class="foot"></div>`;
  try {
    document.getElementById("readout").innerHTML = readout(await get(`${base()}/latest.json`));
  } catch { /* the page itself reports missing data */ }
  const gen = (await get(`${base()}/latest.json`).catch(() => null))?.meta?.generated_utc;
  document.getElementById("footer").innerHTML = `${esc(copy.footer)}${gen ? ` Updated ${esc(gen.replace("T", " ").slice(0, 16))} UTC.` : ""}`;
  addEventListener("hashchange", () => { pulse(); route(); });
  await route();
})();
