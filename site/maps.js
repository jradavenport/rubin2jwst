// Figures, drawn as SVG strings from the JSON products. Interactive marks carry
// data-tip (tooltip HTML) and data-href (link); app.js handles both for every figure.

const D2R = Math.PI / 180;
export const C = {
  fg: "#F5F5F5", muted: "#9EA3A3", grid: "#262a2a", grid2: "#383d3d", label: "#5c6262",
  jwst: "#A260CD", gold: "#E0A93B", amber: "#FAB364",
  track: "#E0A93B",                      // JWST is gold on every map
  det: "#B1F2EF", cand: "#00BABC",        // matched Rubin alerts: detection star / loose ring
  rubin: "#00BABC", teal: ["#0C4A47", "#12726D", "#009FA1", "#00BABC", "#B1F2EF"],
};
// status -> [background, text]; Rubin colours brighten as Rubin gets closer, gold = JWST caught
export const STATUS = {
  "JWST not up": ["#2a2d2d", "#c9cdcd"],
  "no alerts": ["#6A6E6E", "#000"],
  "not covered": ["#058B8C", "#000"],
  "covered, no match": ["#00BABC", "#000"],
  "covered, loose match only": ["#FAB364", "#000"],
  "MATCH": ["#E0A93B", "#000"],
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f = (x, d = 1) => Number(x).toFixed(d);
export const deg = (x) => (x == null ? "—" : `${x < 1 ? f(x, 2) : f(x, 1)}°`);
export const hhmm = (mjdUtc) => new Date((mjdUtc - 40587) * 864e5).toISOString().slice(11, 16);
export const TAI = 37 / 86400;
const mon = (iso) => new Date(iso + "T00:00:00Z").toLocaleString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });
const hit = (tip, href, color, extra = "") =>
  ` class="hit" tabindex="0" data-tip="${esc(tip)}"${href ? ` data-href="${esc(href)}"` : ""} data-c="${color}"${extra}`;

function starPath(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    d += `${i ? "L" : "M"}${f(cx + rr * Math.cos(a), 2)} ${f(cy + rr * Math.sin(a), 2)}`;
  }
  return d + "Z";
}
function niceStep(range, n = 5) {
  const raw = range / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const decimals = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
function sepDeg(ra1, d1, ra2, d2) {
  const h = Math.sin(((d2 - d1) * D2R) / 2) ** 2 + Math.cos(d1 * D2R) * Math.cos(d2 * D2R) * Math.sin(((ra2 - ra1) * D2R) / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(Math.min(1, h)))) / D2R;
}
function ramp(t) { // 0..1 along the Rubin teals
  const s = C.teal, x = Math.max(0, Math.min(1, t)) * (s.length - 1), i = Math.min(s.length - 2, Math.floor(x)), u = x - i;
  const a = s[i].match(/\w\w/g).map((h) => parseInt(h, 16)), b = s[i + 1].match(/\w\w/g).map((h) => parseInt(h, 16));
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(",")})`;
}

// ------------------------------------------------------------------ sky map (Mollweide)
function moll(ra, dec, ra0) {
  const lam = ((((ra0 - ra + 540) % 360) + 360) % 360 - 180) * D2R; // RA increases to the left
  const phi = dec * D2R;
  let th = phi;
  if (Math.abs(phi) < Math.PI / 2 - 1e-9) {
    for (let i = 0; i < 30; i++) {
      const d = (2 * th + Math.sin(2 * th) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * th));
      th -= d;
      if (Math.abs(d) < 1e-10) break;
    }
  }
  return [((2 * Math.SQRT2) / Math.PI) * lam * Math.cos(th), Math.SQRT2 * Math.sin(th), lam];
}

export function skyMap(sky0, { name = "JWST", recent = false } = {}) {
  // recent: only the last `days` nights of track, tiles and hits (the future stays)
  const cut = new Date(Date.parse(sky0.today + "T00:00:00Z") - sky0.days * 864e5).toISOString().slice(0, 10);
  const sky = !recent ? sky0 : { ...sky0, track: sky0.track.filter((p) => p.date > cut),
    footprint: sky0.footprint_recent || sky0.footprint, hits: (sky0.hits || []).filter((h) => h.dayobs > cut) };
  const S = 118, W = 2 * 2 * Math.SQRT2 * S, H = 2 * Math.SQRT2 * S, pad = 14;
  const today = sky.track.find((p) => p.date === sky.today) || sky.track[Math.floor(sky.track.length / 2)];
  const ra0 = today.ra;   // JWST's latest position is always the centre
  const P = (ra, dec) => { const [x, y, l] = moll(ra, dec, ra0); return [x * S, -y * S, l]; };
  const path = (pts) => {
    let d = "", prev = null;
    for (const [ra, dec] of pts) {
      const [x, y, l] = P(ra, dec);
      d += `${prev === null || Math.abs(l - prev) > Math.PI ? "M" : "L"}${f(x, 1)} ${f(y, 1)}`;
      prev = l;
    }
    return d;
  };
  let g = "";
  // graticule
  for (let ra = 0; ra < 360; ra += 30) {          // meridians stay on whole 2h steps
    const [x, y, l] = P(ra, 0);
    if (Math.abs(l) > Math.PI - 5 * D2R) continue; // too close to the edge
    const pts = []; for (let d = -90; d <= 90; d += 3) pts.push([ra, d]);
    g += `<path d="${path(pts)}" stroke="${C.grid}" fill="none"/>`;
    if (ra % 60 === 0 && Math.abs(l) < Math.PI - 30 * D2R)
      g += `<text x="${f(x)}" y="${f(y + 12)}" fill="${C.label}" font-size="10" text-anchor="middle">${ra / 15}h</text>`;
  }
  for (const d of [-60, -30, 0, 30, 60]) {
    const pts = []; for (let r = -179.5; r <= 179.5; r += 3) pts.push([ra0 + r, d]); pts.push([ra0 + 179.5, d]);
    g += `<path d="${path(pts)}" stroke="${d === 0 ? C.grid2 : C.grid}" fill="none"/>`;
    const [x, y] = P(ra0 + 179.5, d);
    if (d) g += `<text x="${f(x - 4)}" y="${f(y + 3)}" fill="${C.label}" font-size="10" text-anchor="end">${d > 0 ? "+" : ""}${d}°</text>`;
  }
  // Rubin footprint over the window: 5 opacity levels by number of nights with new objects
  const fp = sky.footprint, kmax = Math.max(1, ...fp.map((c) => c[2]));
  const lv = ["", "", "", "", ""];
  for (const [ra, dec, k] of fp) {
    const [, , lc] = P(ra + 0.5, dec + 0.5);
    if (Math.abs(lc) > Math.PI - 1.2 * D2R) continue;
    const q = [P(ra, dec), P(ra + 1, dec), P(ra + 1, dec + 1), P(ra, dec + 1)];
    const i = Math.min(4, Math.floor((Math.log(1 + k) / Math.log(1 + kmax)) * 5));
    lv[i] += `M${q.map((p) => `${f(p[0], 1)} ${f(p[1], 1)}`).join("L")}Z`;
  }
  lv.forEach((d, i) => { if (d) g += `<path d="${d}" fill="${C.rubin}" fill-opacity="${[0.22, 0.36, 0.52, 0.7, 0.9][i]}"/>`; });
  g += `<ellipse cx="0" cy="0" rx="${f(2 * Math.SQRT2 * S)}" ry="${f(Math.SQRT2 * S)}" fill="none" stroke="${C.grid2}"/>`;

  // track: past solid, future dotted
  const past = sky.track.filter((p) => p.date <= sky.today), fut = sky.track.filter((p) => p.date >= sky.today);
  g += `<path d="${path(fut.map((p) => [p.ra, p.dec]))}" stroke="${C.track}" stroke-opacity=".75" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round" fill="none"/>`;
  g += `<path d="${path(past.map((p) => [p.ra, p.dec]))}" stroke="${C.track}" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  // hover targets, one per day
  for (const p of sky.track) {
    const [x, y] = P(p.ra, p.dec);
    const fut = p.date > sky.today;
    const tip = `<b>${p.date}</b><br>${fut ? "future" : esc(p.status || "not checked")}` +
      (p.nearest_alert_deg != null ? `<br>nearest alert ${deg(p.nearest_alert_deg)}` : "") +
      `<br><span class="m">${name} at RA ${f(p.ra)}°, Dec ${f(p.dec)}°</span>`;
    g += `<circle cx="${f(x, 1)}" cy="${f(y, 1)}" r="5" fill="transparent"${hit(tip, p.status ? `#/night/${p.date}` : null, (STATUS[p.status] || [C.track])[0])}/>`;
  }
  // matched alerts: detections only; loose candidates are on the night pages
  for (const h of (sky.hits || []).filter((h) => h.tight)) {
    const [x, y] = P(h.ra, h.dec);
    const tip = `<b>${h.dayobs}</b><br>detection · ${esc(h.band || "")} · ${f(h.sep_arcsec, 2)}″`;
    g += `<path d="${starPath(x, y, 9)}" fill="${C.det}" stroke="#000" stroke-width="1"${hit(tip, `#/night/${h.dayobs}`, C.det)}/>`;
  }
  // today
  const [tx, ty] = P(today.ra, today.dec);
  g += `<circle cx="${f(tx)}" cy="${f(ty)}" r="9" fill="none" stroke="${C.gold}" stroke-width="1.5"/>` +
       `<circle cx="${f(tx)}" cy="${f(ty)}" r="4" fill="${C.fg}"/>` +
       `<text x="${f(tx + 13)}" y="${f(ty + 4)}" fill="${C.gold}" font-size="12">${name} · ${mon(sky.today)}</text>`;
  return `<svg viewBox="${f(-W / 2 - pad)} ${f(-H / 2 - pad)} ${f(W + 2 * pad)} ${f(H + 2 * pad)}" role="img" aria-label="All-sky map of ${name}'s track and Rubin's alert footprint">${g}</svg>`;
}

// ----------------------------------------------------------------- one night (plot_night)
export function nightMap(night, { name = "JWST" } = {}) {
  const tr = night.track || {};
  if (!tr.ra || !tr.ra.length) return "";
  const n = tr.ra.length;
  let ra0 = tr.ra[n >> 1];
  const unwrap = (ra) => ra0 + ((((ra - ra0 + 180) % 360) + 360) % 360) - 180;
  const xs = tr.ra.map(unwrap), ys = tr.dec;
  const dec0 = ys.reduce((a, b) => a + b, 0) / n;
  const cosd = Math.max(Math.cos(dec0 * D2R), 0.2);
  const covered = night.n_in_boxes != null;
  const ptp = (a) => Math.max(...a) - Math.min(...a);
  let half;
  if (covered) {
    half = Math.max(0.7 * Math.max(ptp(xs) * cosd, ptp(ys)), 0.02);
    ra0 = (Math.min(...xs) + Math.max(...xs)) / 2;
  } else half = Math.max(6, 1.2 * (night.nearest_alert_deg || 0) + 3);
  const xhw = Math.min(half / cosd, 180);
  const x0 = ra0 - xhw, x1 = ra0 + xhw, y0 = Math.max(dec0 - half, -90), y1 = Math.min(dec0 + half, 90);
  const ML = 52, MB = 34, MT = 10, MR = 12, PW = 560, PH = 470;
  const X = (ra) => ML + ((x1 - unwrap(ra)) / (x1 - x0)) * PW; // RA increases to the left
  const Y = (dec) => MT + ((y1 - dec) / (y1 - y0)) * PH;
  let g = `<defs><clipPath id="clip"><rect x="${ML}" y="${MT}" width="${PW}" height="${PH}"/></clipPath></defs>`;
  // axes & grid
  const sx = niceStep(x1 - x0), sy = niceStep(y1 - y0), dx = decimals(sx), dy = decimals(sy);
  for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) {
    const x = ML + ((x1 - v) / (x1 - x0)) * PW;
    g += `<line x1="${f(x)}" x2="${f(x)}" y1="${MT}" y2="${MT + PH}" stroke="${C.grid}"/>` +
         `<text x="${f(x)}" y="${MT + PH + 16}" fill="${C.muted}" font-size="11" text-anchor="middle">${f((((v % 360) + 360) % 360), dx)}</text>`;
  }
  for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) {
    const y = Y(v);
    g += `<line x1="${ML}" x2="${ML + PW}" y1="${f(y)}" y2="${f(y)}" stroke="${C.grid}"/>` +
         `<text x="${ML - 6}" y="${f(y + 4)}" fill="${C.muted}" font-size="11" text-anchor="end">${f(v, dy)}</text>`;
  }
  g += `<text x="${ML + PW / 2}" y="${MT + PH + 31}" fill="${C.muted}" font-size="11" text-anchor="middle">RA (DEG)</text>` +
       `<text transform="translate(12 ${MT + PH / 2}) rotate(-90)" fill="${C.muted}" font-size="11" text-anchor="middle">DEC (DEG)</text>`;
  g += `<rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="none" stroke="${C.grid2}"/>`;

  let body = "";
  // footprint (wide view only, as in plot_night)
  const cells = night.footprint || [];
  if (cells.length && !covered) {
    const vmax = Math.max(10, ...cells.map((c) => c[2]));
    for (const [ra, dec, k] of cells) {
      const xa = X(ra + 1), xb = X(ra);
      const cx = unwrap(ra + 0.5);
      if (cx < x0 - 1 || cx > x1 + 1 || dec + 1 < y0 || dec > y1) continue;
      const t = 0.15 + 0.85 * (Math.log(k) / Math.log(vmax));
      body += `<rect x="${f(Math.min(xa, xb), 1)}" y="${f(Y(dec + 1), 1)}" width="${f(Math.abs(xb - xa) + 0.4, 1)}" height="${f(Y(dec) - Y(dec + 1) + 0.4, 1)}" fill="${ramp(t)}"` +
        hit(`<b>${k.toLocaleString("en-US")}</b> new Lasair object${k === 1 ? "" : "s"}<br>in this 1° cell (RA ${ra}–${ra + 1}°, Dec ${dec}–${dec + 1}°)`, null, C.rubin, ' tabindex="-1"') + `/>`;
    }
    // nearest alert line
    let best = [Infinity, 0, 0];
    tr.ra.forEach((ra, i) => cells.forEach((c, k) => {
      const s = sepDeg(ra, tr.dec[i], c[0] + 0.5, c[1] + 0.5);
      if (s < best[0]) best = [s, i, k];
    }));
    const [, i, k] = best, c = cells[k];
    const ax = X(tr.ra[i]), ay = Y(tr.dec[i]), bx = X(c[0] + 0.5), by = Y(c[1] + 0.5);
    body += `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}" stroke="${C.rubin}" stroke-width="1.5" stroke-dasharray="5 4"/>` +
            `<text x="${f((ax + bx) / 2 + 8)}" y="${f((ay + by) / 2 - 6)}" fill="${C.rubin}" font-size="13">NEAREST ALERT ${deg(night.nearest_alert_deg)}</text>`;
  }
  // track
  body += `<polyline points="${tr.ra.map((ra, i) => `${f(X(ra), 1)},${f(Y(tr.dec[i]), 1)}`).join(" ")}" fill="none" stroke="${C.track}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  [[0, -9], [n - 1, 17]].forEach(([j, dyy]) => {
    body += `<text x="${f(X(tr.ra[j]))}" y="${f(Y(tr.dec[j]) + dyy)}" fill="${C.track}" font-size="11" text-anchor="middle">${j ? "" : `${esc(name)} · `}${hhmm(tr.mjd_utc[j])} UTC</text>`;
  });
  // matches
  const ms = [...(night.matches || [])].sort((a, b) => a.mjd_tai - b.mjd_tai);
  ms.forEach((m, k) => {
    const x = X(m.ra), y = Y(m.dec), col = m.tight ? C.det : C.cand;
    const t = hhmm(m.mjd_tai - TAI);
    const tip = `<b>${t} UTC · ${esc(m.band || "?")} · ${f(m.sep_arcsec, 2)}″</b><br>` +
      `${m.tight ? "detection (&lt; 2″)" : "loose candidate (2–20″)"}<br>` +
      (m.mag != null ? `mag ${f(m.mag, 2)} · ` : "") + (m.snr != null ? `S/N ${f(m.snr, 1)}` : "") +
      (m.reliability != null ? ` · rel ${f(m.reliability, 2)}` : "") +
      (m.trailLength != null ? `<br>trail ${f(m.trailLength, 2)}″` : "") + (m.pixelFlags_saturated ? " · saturated" : "") +
      `<br>visit ${esc(m.visit ?? "?")} · det ${esc(m.detector ?? "?")}<br>ΔRA ${f(m.dra_arcsec, 2)}″ ΔDec ${f(m.ddec_arcsec, 2)}″` +
      `<br><span class="m">${esc(m.diaObjectId)}</span>`;
    body += m.tight
      ? `<path d="${starPath(x, y, 13)}" fill="${col}" stroke="#000" stroke-width="1.5"${hit(tip, m.lasair_url, col)}/>`
      : `<circle cx="${f(x)}" cy="${f(y)}" r="6" fill="#000" stroke="${col}" stroke-width="2.5"${hit(tip, m.lasair_url, col)}/>`;
    body += `<text x="${f(x + 14)}" y="${f(y + (k % 2 ? 20 : -12))}" fill="${C.fg}" font-size="12">${t} UTC ${esc(m.band || "")} · ${f(m.sep_arcsec, 2)}″</text>`;
  });
  g += `<g clip-path="url(#clip)">${body}</g>`;
  return `<svg viewBox="0 0 ${ML + PW + MR} ${MT + PH + MB + 6}" role="img" aria-label="Map of ${name}'s track on ${night.dayobs}">${g}</svg>`;
}

// ------------------------------------------------------------ distance to nearest alert
export function distChart(nights, { name = "JWST", compact = false } = {}) {
  const rows = nights.filter((r) => r.nearest_alert_deg != null);
  if (!rows.length) return "";
  const t = (iso) => Date.parse(iso + "T00:00:00Z");
  const ML = 44, MR = 12, MT = 12, MB = 26, PW = compact ? 380 : 860, PH = compact ? 260 : 230;
  const t0 = t(nights[0].dayobs), t1 = Math.max(t(nights[nights.length - 1].dayobs), t0 + 864e5);
  const vmin = Math.min(...rows.map((r) => r.nearest_alert_deg));
  const lo = Math.log10(Math.min(0.5, Math.max(vmin, 0.005) / 1.6)), hi = Math.log10(180);
  const X = (iso) => ML + ((t(iso) - t0) / (t1 - t0)) * PW;
  const Y = (v) => MT + ((hi - Math.log10(Math.max(v, 10 ** lo))) / (hi - lo)) * PH;
  let g = `<rect x="${ML}" y="${f(Y(3))}" width="${PW}" height="${f(MT + PH - Y(3))}" fill="${C.rubin}" fill-opacity=".1"/>` +
          `<line x1="${ML}" x2="${ML + PW}" y1="${f(Y(3))}" y2="${f(Y(3))}" stroke="${C.rubin}" stroke-opacity=".5" stroke-dasharray="3 3"/>` +
          `<text x="${ML + 6}" y="${f(Y(3) + 14)}" fill="${C.rubin}" font-size="11">COVERED (&lt; 3°): CHECKED ALERT BY ALERT</text>`;
  for (const v of [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 90, 180]) {
    if (Math.log10(v) < lo - 1e-9) continue;
    const y = Y(v);
    g += `<line x1="${ML}" x2="${ML + PW}" y1="${f(y)}" y2="${f(y)}" stroke="${C.grid}"/>` +
         `<text x="${ML - 6}" y="${f(y + 4)}" fill="${C.muted}" font-size="11" text-anchor="end">${v}°</text>`;
  }
  const d = new Date(t0);
  for (let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); m.getTime() <= t1; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const iso = m.toISOString().slice(0, 10), x = X(iso), jan = m.getUTCMonth() === 0;
    if (compact && !jan && m.getUTCMonth() % 3) { g += `<line x1="${f(x)}" x2="${f(x)}" y1="${MT}" y2="${MT + PH}" stroke="${C.grid}"/>`; continue; }
    g += `<line x1="${f(x)}" x2="${f(x)}" y1="${MT}" y2="${MT + PH}" stroke="${jan ? C.grid2 : C.grid}"/>` +
         `<text x="${f(x + 3)}" y="${MT + PH + 16}" fill="${C.muted}" font-size="11">${jan ? m.getUTCFullYear() : m.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase()}</text>`;
  }
  for (const r of rows) {
    const col = (STATUS[r.status] || [C.fg])[0];
    const tip = `<b>${r.dayobs}</b><br>${esc(r.status)}<br>nearest alert ${deg(r.nearest_alert_deg)}<br>${(r.n_new_objects || 0).toLocaleString("en-US")} new Lasair objects`;
    g += `<circle cx="${f(X(r.dayobs), 1)}" cy="${f(Y(r.nearest_alert_deg), 1)}" r="3.6" fill="${col}"${hit(tip, `#/night/${r.dayobs}`, col)}/>`;
  }
  return `<svg viewBox="0 0 ${ML + PW + MR} ${MT + PH + MB}" role="img" aria-label="Distance from ${name} to the nearest Rubin alert, per night">${g}</svg>`;
}
