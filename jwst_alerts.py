"""Look for JWST in the public Rubin Observatory alert stream (via the Lasair-LSST broker).

For each Rubin night:
  1. Ephemeris. JWST's track as seen from Rubin (JPL Horizons, target -170, site X05),
     every 5 min while the Sun is down. Topocentric matters: at L2 the parallax is
     10-15 arcmin.
  2. Coverage. Count that night's new Lasair objects per 1x1 deg sky cell and measure the
     distance from JWST's track to the nearest one. If nothing came within COVER_DEG,
     Rubin didn't point near JWST and we stop.
  3. Match. Otherwise, fetch objects in small time-sliced boxes along the track and
     compare each with JWST's predicted position at that object's detection time.
     JWST moves 1-3"/min, so a detection normally becomes a NEW object (matched via its
     first-detection time); if it lands within ~1" of an existing object it is attached
     to that object instead (matched via its last-detection time).
     Within 2" = detection ("MATCH"); 2-20" = loose match, check by eye.

Each night produces output/<target>/nights/<dayobs>.json (everything, including the track,
the footprint and any matches with their Lasair links) and output/<target>/plots/<dayobs>.png
made from that JSON alone. publish.py then rebuilds the summary products (latest, week,
nights, alerts archive, sky map) from the nights/ files. Targets are listed in targets.json.

    python jwst_alerts.py                       # the last 3 finished nights
    python jwst_alerts.py --night 2026-11-10    # one night
    python jwst_alerts.py --nights 7 --no-plot
    python jwst_alerts.py --since 2025-10-24    # backfill from the start of the alert stream

Needs a Lasair-LSST API token in $LASAIR_TOKEN or ~/.lasair_lsst_token.
Exit code 2 if any night has a MATCH.
"""
import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

import numpy as np
import requests

# ----------------------------------------------------------------------------- settings
TARGET = "-170"               # JWST in JPL Horizons
SITE = "X05"                  # Rubin Observatory (MPC code)
STEP_MIN = 5                  # ephemeris step, minutes
MIN_ALT_DEG = 20              # ignore the track below this altitude
COVER_DEG = 3.0               # run the match only if an alert came this close (deg)
PAD_ARCSEC = 120.0            # search-box padding around the predicted track
CHUNK_HOURS = 2.0             # search boxes are cut into time slices this long
MATCH_ARCSEC = 20.0           # report alerts within this distance of the prediction
TIGHT_ARCSEC = 2.0            # ... and call it a detection within this distance
TAI_MINUS_UTC = 37 / 86400    # days
MJD0 = dt.datetime(1858, 11, 17)

HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
LASAIR_API = "https://lasair.lsst.ac.uk/api"
LASAIR_OBJECT_URL = "https://lasair.lsst.ac.uk/objects/{}/"
LASAIR_MAX_ROWS = 10000       # Lasair's row cap per query
LASAIR_MAX_SQL = 4000         # Lasair rejects SQL conditions longer than 4096 chars


# --------------------------------------------------------------------------------- time
def night_window(dayobs: dt.date) -> tuple[float, float]:
    """Rubin night `dayobs` runs from 12:00 UTC that day to 12:00 UTC the next (MJD UTC)."""
    m0 = (dt.datetime(dayobs.year, dayobs.month, dayobs.day, 12) - MJD0).total_seconds() / 86400
    return m0, m0 + 1


def last_finished_night() -> dt.date:
    """(now - 12 h) is the current dayObs, which may still be in progress; step back one."""
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=12)).date() - dt.timedelta(days=1)


def utc_hhmm(mjd_utc: float) -> str:
    return (MJD0 + dt.timedelta(days=mjd_utc)).strftime("%H:%M")


# ---------------------------------------------------------------------------- geometry
def sep_arcsec(ra1, dec1, ra2, dec2):
    """Great-circle separation, arcsec (inputs in degrees, broadcastable)."""
    ra1, dec1, ra2, dec2 = map(np.deg2rad, (ra1, dec1, ra2, dec2))
    h = np.sin((dec2 - dec1) / 2) ** 2 + np.cos(dec1) * np.cos(dec2) * np.sin((ra2 - ra1) / 2) ** 2
    return np.rad2deg(2 * np.arcsin(np.sqrt(h))) * 3600


def predict(track: dict, mjd_tai):
    """Track position at the given times (linear interpolation of the 5-min grid; the
    error from the curved, parallax-driven motion is < 0.1")."""
    t = np.asarray(track["mjd_tai"])
    ra = np.rad2deg(np.unwrap(np.deg2rad(track["ra"])))
    return np.interp(mjd_tai, t, ra) % 360, np.interp(mjd_tai, t, track["dec"])


# ---------------------------------------------------------------------------- Horizons
def get_track(dayobs: dt.date, target: str = TARGET) -> dict:
    """Topocentric (X05) track for one night, Sun down and altitude > MIN_ALT_DEG.

    Returns {"mjd_tai": [...], "mjd_utc": [...], "ra": [...], "dec": [...], "alt": [...]}.
    """
    m0, m1 = night_window(dayobs)
    fmt = lambda m: (MJD0 + dt.timedelta(days=m)).strftime("'%Y-%m-%d %H:%M'")
    params = dict(format="json", COMMAND=f"'{target}'", CENTER=f"'{SITE}'", MAKE_EPHEM="'YES'",
                  EPHEM_TYPE="'OBSERVER'", START_TIME=fmt(m0), STOP_TIME=fmt(m1),
                  STEP_SIZE=f"'{STEP_MIN}m'", QUANTITIES="'1,4'", CSV_FORMAT="'YES'",
                  SKIP_DAYLT="'YES'", ANG_FORMAT="'DEG'", CAL_FORMAT="'JD'", EXTRA_PREC="'YES'")
    r = requests.get(HORIZONS_API, params=params, timeout=120)
    r.raise_for_status()
    text = r.json()["result"]
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons error:\n{text[:2000]}")
    rows = []
    for line in text.split("$$SOE")[1].split("$$EOE")[0].splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) >= 7 and f[0][:1].isdigit():  # JD, sun, moon, RA, Dec, Az, El
            rows.append((float(f[0]) - 2400000.5, float(f[3]), float(f[4]), float(f[6])))
    rows = [r for r in rows if r[3] > MIN_ALT_DEG]
    mjd = [r[0] for r in rows]
    return dict(mjd_utc=mjd, mjd_tai=[m + TAI_MINUS_UTC for m in mjd],
                ra=[r[1] for r in rows], dec=[r[2] for r in rows], alt=[r[3] for r in rows])


# ------------------------------------------------------------------------------ Lasair
def lasair_token() -> str:
    tok = os.environ.get("LASAIR_TOKEN")
    f = Path("~/.lasair_lsst_token").expanduser()
    if not tok and f.exists():
        tok = f.read_text().strip()
    if not tok:
        sys.exit("Need a Lasair-LSST API token in $LASAIR_TOKEN or ~/.lasair_lsst_token "
                 "(from your profile at https://lasair.lsst.ac.uk).")
    return tok


def lasair(method: str, **data):
    """POST to the Lasair-LSST API; returns the decoded JSON."""
    r = requests.post(f"{LASAIR_API}/{method}/", data=data, timeout=300,
                      headers={"Authorization": f"Token {lasair_token()}"})
    if r.status_code != 200:
        raise RuntimeError(f"Lasair {method} HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


def query(select: str, where: str, limit: int = LASAIR_MAX_ROWS) -> list[dict]:
    return lasair("query", selected=select, tables="objects", conditions=where, limit=limit)


def footprint(m0_tai: float, m1_tai: float) -> list[tuple[float, float, int]]:
    """New objects (first detected in [m0, m1]) per 1x1 deg cell: [(ra_lo, dec_lo, n), ...].

    Lasair counts server-side, so every object is counted; if the number of occupied
    cells hits the row cap, the window is split in half so nothing is silently dropped.
    """
    rows = query("FLOOR(objects.ra) AS rr, FLOOR(objects.decl) AS dd, COUNT(*) AS n",
                 f"firstDiaSourceMjdTai BETWEEN {m0_tai:.5f} AND {m1_tai:.5f} GROUP BY rr, dd")
    if len(rows) >= LASAIR_MAX_ROWS and m1_tai - m0_tai > 1 / 1440:
        mid = (m0_tai + m1_tai) / 2
        cells = {}
        for ra, dec, n in footprint(m0_tai, mid) + footprint(mid, m1_tai):
            cells[(ra, dec)] = cells.get((ra, dec), 0) + n
        return [(ra, dec, n) for (ra, dec), n in cells.items()]
    return [(float(r["rr"]), float(r["dd"]), int(r["n"])) for r in rows]


def object_sources(object_id) -> list[dict]:
    """diaSources of one object. lasair_added=True fails server-side (checked 2026-11);
    lite=False has all ~100 fields but is sometimes empty for new objects."""
    for lite in (False, True):
        o = lasair("object", objectId=object_id, lite=lite, lasair_added=False)
        if o.get("diaSourcesList"):
            return o["diaSourcesList"]
    return []


# ------------------------------------------------------------------------------ search
def search_boxes(track: dict) -> list[tuple]:
    """(t0, t1, ra_lo, ra_hi, dec_lo, dec_hi) boxes covering the track, CHUNK_HOURS each."""
    t = np.asarray(track["mjd_tai"])
    pad = PAD_ARCSEC / 3600
    boxes, start = [], t[0]
    while start < t[-1]:
        t0, t1 = start - 5 / 1440, min(start + CHUNK_HOURS / 24, t[-1]) + 5 / 1440  # 5-min overlap
        ra, dec = predict(track, np.linspace(t0, t1, 30))
        ra = np.rad2deg(np.unwrap(np.deg2rad(ra)))
        rpad = pad / max(np.cos(np.deg2rad(np.abs(dec).max() + pad)), 0.05)
        boxes.append((t0, t1, ra.min() - rpad, ra.max() + rpad, dec.min() - pad, dec.max() + pad))
        start += CHUNK_HOURS / 24
    return boxes


def box_sql(b) -> str:
    t0, t1, rlo, rhi, dlo, dhi = b
    t = f"BETWEEN {t0:.5f} AND {t1:.5f}"
    rlo, rhi = rlo % 360, rhi % 360
    ra = f"ra BETWEEN {rlo:.4f} AND {rhi:.4f}" if rlo <= rhi else f"(ra >= {rlo:.4f} OR ra <= {rhi:.4f})"
    return (f"((firstDiaSourceMjdTai {t} OR lastDiaSourceMjdTai {t}) "
            f"AND decl BETWEEN {dlo:.4f} AND {dhi:.4f} AND {ra})")


def find_matches(track: dict, w0_tai: float, w1_tai: float) -> tuple[int, list[dict]]:
    """Objects near the track; returns (number of objects in the boxes, matches)."""
    boxes = search_boxes(track)
    objs, batch = {}, []
    for b in boxes + [None]:  # OR boxes together, staying under Lasair's SQL length limit
        if b is not None and len(" OR ".join(batch + [box_sql(b)])) <= LASAIR_MAX_SQL:
            batch.append(box_sql(b))
            continue
        for o in query("objects.diaObjectId, objects.ra, objects.decl, objects.firstDiaSourceMjdTai, "
                       "objects.lastDiaSourceMjdTai", " OR ".join(batch)):
            objs[o["diaObjectId"]] = o
        batch = [box_sql(b)] if b is not None else []

    matches = []
    for o in objs.values():
        best = None
        for kind in ("first", "last"):  # compare at whichever detection time is in the night
            t = float(o[f"{kind}DiaSourceMjdTai"])
            if not w0_tai <= t <= w1_tai:
                continue
            pra, pdec = predict(track, t)
            s = float(sep_arcsec(float(o["ra"]), float(o["decl"]), pra, pdec))
            if best is None or s < best["sep_arcsec"]:
                dra = ((float(o["ra"]) - pra + 180) % 360 - 180) * np.cos(np.deg2rad(pdec)) * 3600
                best = dict(diaObjectId=str(o["diaObjectId"]), lasair_url=LASAIR_OBJECT_URL.format(o["diaObjectId"]),
                            mjd_tai=t, ra=float(o["ra"]), dec=float(o["decl"]), sep_arcsec=round(s, 3),
                            dra_arcsec=round(float(dra), 3), ddec_arcsec=round((float(o["decl"]) - pdec) * 3600, 3),
                            matched_on=kind)
        if best and best["sep_arcsec"] < MATCH_ARCSEC:
            best["tight"] = best["sep_arcsec"] < TIGHT_ARCSEC
            best.update(detection_details(best["diaObjectId"], best["mjd_tai"]))
            matches.append(best)
    return len(objs), sorted(matches, key=lambda m: m["sep_arcsec"])


def detection_details(object_id: str, mjd_tai: float) -> dict:
    """Band, magnitude, quality and image info for the detection at mjd_tai."""
    try:
        srcs = object_sources(object_id)
    except Exception as e:  # details are a bonus; never lose a match over them
        return {"details_error": str(e)[:200]}
    if not srcs:
        return {}
    s = min(srcs, key=lambda s: abs(float(s.get("midpointMjdTai", 1e9)) - mjd_tai))
    flux = s.get("psfFlux")
    out = {k: s.get(k) for k in ("diaSourceId", "band", "snr", "reliability", "trailLength",
                                 "pixelFlags_saturated", "visit", "detector") if k in s}
    for k, nd in (("snr", 2), ("reliability", 4), ("trailLength", 3)):  # readable, no lost information
        if out.get(k) is not None:
            out[k] = round(float(out[k]), nd)
    if flux and float(flux) > 0:
        out["mag"] = round(31.4 - 2.5 * np.log10(float(flux)), 3)  # psfFlux is in nJy
    return out


def check_night(dayobs: dt.date, target: str = TARGET) -> dict:
    """Run the full check for one night and return the result record (JSON-ready)."""
    m0, m1 = night_window(dayobs)
    w0, w1 = m0 + TAI_MINUS_UTC, m1 + TAI_MINUS_UTC
    res = dict(dayobs=dayobs.isoformat(), target=target,
               checked_utc=dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
               status=None, n_new_objects=0, nearest_alert_deg=None, n_in_boxes=None,
               n_match=0, n_tight=0, matches=[], track={}, footprint=[])
    track = get_track(dayobs, target)
    # stored track: mjd_tai is left out (always mjd_utc + 37 s); positions to 1e-6 deg
    res["track"] = {k: [round(x, 6) for x in v] for k, v in track.items() if k != "mjd_tai"}
    if not track["mjd_tai"]:
        res["status"] = "JWST not up"
        return res

    cells = footprint(w0, w1)
    res["footprint"] = cells
    res["n_new_objects"] = sum(n for _, _, n in cells)
    if not cells:
        res["status"] = "no alerts"
        return res
    c = np.array(cells, float)
    d = sep_arcsec(np.array(track["ra"])[:, None], np.array(track["dec"])[:, None],
                   c[None, :, 0] + 0.5, c[None, :, 1] + 0.5).min() / 3600
    res["nearest_alert_deg"] = round(float(d), 2)
    if d > COVER_DEG:
        res["status"] = "not covered"
        return res

    res["n_in_boxes"], res["matches"] = find_matches(track, w0, w1)
    res["n_match"] = len(res["matches"])
    res["n_tight"] = sum(m["tight"] for m in res["matches"])
    res["status"] = ("MATCH" if res["n_tight"] else
                     "covered, loose match only" if res["n_match"] else "covered, no match")
    return res


# -------------------------------------------------------------------------------- plot
def plot_night(res: dict, path: Path):
    """Map of one night, drawn from the result record alone.

    Not covered: wide view of that night's new objects (1-deg cells) around JWST, with the
    distance to the nearest one. Covered: zoom on JWST's track; matches as red stars
    (< 2") or orange dots (2-20"), labelled with time and band.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm
    from matplotlib.patches import Rectangle

    tr = res["track"]
    fig, ax = plt.subplots(figsize=(8.5, 7))
    title = f"JWST vs Rubin alerts  ·  {res['dayobs']}  ·  {res['status']}"
    if not tr.get("ra"):
        ax.text(0.5, 0.5, "JWST not above 20° altitude during the night", ha="center", transform=ax.transAxes)
        ax.set_title(title, loc="left")
        fig.savefig(path, dpi=120)
        plt.close(fig)
        return
    ra0 = float(tr["ra"][len(tr["ra"]) // 2])
    unwrap = lambda ra: ra0 + ((np.asarray(ra, float) - ra0 + 180) % 360 - 180)  # continuous RA
    x, y = unwrap(tr["ra"]), np.asarray(tr["dec"])
    dec0 = float(y.mean())
    cosd = max(np.cos(np.deg2rad(dec0)), 0.2)
    covered = res["n_in_boxes"] is not None
    if covered:
        half = max(0.7 * max(np.ptp(x) * cosd, np.ptp(y)), 0.02)
        ra0 = float(x.min() + x.max()) / 2
    else:
        half = max(6.0, 1.2 * (res["nearest_alert_deg"] or 0) + 3)

    if res["footprint"] and not covered:
        cells = np.array(res["footprint"], float)
        norm = LogNorm(vmin=1, vmax=max(cells[:, 2].max(), 10))
        cmap = plt.get_cmap("Greys")
        for ra, dec, n in cells:
            ax.add_patch(Rectangle((unwrap(ra + 0.5) - 0.5, dec), 1, 1, lw=0, color=cmap(norm(n) * 0.55 + 0.1)))
        fig.colorbar(plt.cm.ScalarMappable(norm=norm, cmap="Greys"), ax=ax, pad=0.01, fraction=0.04) \
           .set_label("new objects per 1° cell (first detected this night)")
        d = sep_arcsec(np.asarray(tr["ra"])[:, None], y[:, None], cells[None, :, 0] + 0.5, cells[None, :, 1] + 0.5)
        i, k = np.unravel_index(np.argmin(d), d.shape)
        cx, cy = unwrap(cells[k, 0] + 0.5), cells[k, 1] + 0.5
        ax.plot([x[i], cx], [y[i], cy], "--", color="#c4422b", lw=1)
        ax.text((x[i] + cx) / 2, (y[i] + cy) / 2, f" nearest alert {res['nearest_alert_deg']:.1f}°",
                color="#c4422b")

    ax.plot(x, y, color="#2f6fb0", lw=2.5, label="JWST track (alt > 20°)", zorder=3)
    for j, dy in ((0, 8), (-1, -14)):
        ax.annotate(utc_hhmm(tr["mjd_utc"][j]) + " UTC", (x[j], y[j]), xytext=(-6, dy),
                    textcoords="offset points", fontsize=7, color="#2f6fb0")
    for k, m in enumerate(sorted(res["matches"], key=lambda m: m["mjd_tai"])):
        star = m["tight"]
        ax.plot(unwrap(m["ra"]), m["dec"], "*" if star else "o", ms=16 if star else 8,
                color="#d1242f" if star else "#e8912d", mec="white", zorder=5)
        ax.annotate(f"{utc_hhmm(m['mjd_tai'] - TAI_MINUS_UTC)} UTC {m.get('band', '')}  {m['sep_arcsec']:.2f}″",
                    (unwrap(m["ra"]), m["dec"]), xytext=(8, 12 if k % 2 else -16),
                    textcoords="offset points", fontsize=8)

    ax.set_xlim(ra0 + min(half / cosd, 180), ra0 - min(half / cosd, 180))  # RA increases to the left
    ax.set_ylim(max(dec0 - half, -90), min(dec0 + half, 90))
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v % 360:g}"))
    ax.set_xlabel("RA (deg)")
    ax.set_ylabel("Dec (deg)")
    ax.grid(alpha=0.3)
    ax.legend(loc="upper left", frameon=False, fontsize=8)
    ax.set_title(f"{title}  ·  {res['n_new_objects']:,} new Lasair objects", loc="left", fontsize=11)
    fig.text(0.01, 0.005, "Counts are NEW objects in Lasair-LSST (first detected this night), not Rubin's "
             "total alerts:\nre-detections of known objects also send alerts and are not counted here.",
             fontsize=7.5, color="#6e7781")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(path, dpi=120)
    plt.close(fig)


# --------------------------------------------------------------------------------- CLI
def load_target(slug: str | None = None) -> dict:
    """Entry from targets.json (the first one if slug is None)."""
    targets = json.loads((Path(__file__).parent / "targets.json").read_text())
    if slug is None:
        return targets[0]
    for t in targets:
        if t["slug"] == slug:
            return t
    sys.exit(f"Unknown target {slug!r}; targets.json has {[t['slug'] for t in targets]}")


def save(res: dict, out: Path, plot: bool = True):
    """Write <out>/nights/<dayobs>.json (and plots/<dayobs>.png). Every other product
    (summaries, alert archive, sky map) is rebuilt from these files by publish.py."""
    (out / "nights").mkdir(parents=True, exist_ok=True)
    (out / f"nights/{res['dayobs']}.json").write_text(json.dumps(res))
    if plot:
        (out / "plots").mkdir(exist_ok=True)
        plot_night(res, out / f"plots/{res['dayobs']}.png")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--night", help="check one dayObs (YYYY-MM-DD)")
    p.add_argument("--nights", type=int, default=3, help="check the last N finished nights (default 3)")
    p.add_argument("--since", help="check every night from this dayObs (YYYY-MM-DD) to the last finished one")
    p.add_argument("--target", help="slug from targets.json (default: the first, jwst)")
    p.add_argument("--out", default="output", help="output folder (default ./output); "
                   "results go in <out>/<target slug>/")
    p.add_argument("--no-plot", action="store_true")
    p.add_argument("--no-publish", action="store_true", help="skip rebuilding the summary products")
    a = p.parse_args(argv)

    tgt = load_target(a.target)
    last = last_finished_night()
    if a.night:
        nights = [dt.date.fromisoformat(a.night)]
    elif a.since:
        d0 = dt.date.fromisoformat(a.since)
        nights = [d0 + dt.timedelta(days=k) for k in range((last - d0).days + 1)]
    else:  # re-check recent nights: alerts can reach Lasair late
        nights = [last - dt.timedelta(days=k) for k in reversed(range(a.nights))]
    out = Path(a.out) / tgt["slug"]
    hit = False
    for n in nights:
        res = check_night(n, target=tgt["horizons_id"])
        save(res, out, plot=not a.no_plot)
        hit |= res["status"] == "MATCH"
        near = f"  nearest alert {res['nearest_alert_deg']}°" if res["nearest_alert_deg"] is not None else ""
        print(f"{res['dayobs']}  {res['status']:<26} new objects={res['n_new_objects']:>7}{near}")
        for m in res["matches"]:
            print(f"    {m['sep_arcsec']:6.2f}\"  {m.get('band', '?')} {m.get('mag', '')}  {m['lasair_url']}")
    if not a.no_publish:
        import publish
        publish.publish(Path(a.out), tgt)
    return 2 if hit else 0


if __name__ == "__main__":
    sys.exit(main())
