"""Rebuild the summary products for one target from its per-night records.

Reads  <out>/<slug>/nights/*.json  (written by jwst_alerts.py) and writes, next to them:

    latest.json   the last finished night, the last match, running totals    (quick read)
    week.json     the last 7 nights, one summary row each                    (quick read)
    nights.csv    every night ever checked, one row each                     (+ nights.json)
    alerts.csv    every Rubin alert ever matched to the target, one row each (+ alerts.json)
    sky.json      the target's track from the first checked night to SKY_DAYS ahead of today,
                  Rubin's alert footprint over every checked night, and every matched alert
and <out>/targets.json (the target list, for the website).

Everything except the sky track comes from the nights/ files, so the products can't drift
from the per-night records. The sky track is one JPL Horizons call (daily positions).

    python publish.py                 # all targets in targets.json, in ./output

Demo of the MATCH layout (local only; demo/ is never committed): asteroid 2022 WM44 stands in
for JWST on 2026-10-29, giving two Rubin detections at 0.09" and 0.14".
    python -c "import datetime as dt, pathlib, jwst_alerts as J; r = J.check_night(dt.date(2026, 10, 29), target='DES=2022 WM44;'); r['demo'] = 'DEMO: asteroid 2022 WM44 standing in for JWST. Not a JWST detection.'; J.save(r, pathlib.Path('demo/jwst'), plot=False)"
    python publish.py --out demo --horizons-id "DES=2022 WM44;"
    ln -sfn ../demo site/demo         # then open http://localhost:8765/?data=demo
"""
import argparse
import csv
import datetime as dt
import json
import os
import subprocess
from pathlib import Path

import requests

import jwst_alerts as J

SCHEMA = 1
SKY_DAYS = 60       # sky map: track this many days ahead; 'recent' view = this many days back
WEEK = 7

NIGHT_COLS = ["dayobs", "status", "n_new_objects", "nearest_alert_deg", "n_in_boxes", "n_match",
              "n_tight", "track_start_utc", "track_end_utc", "ra_mid", "dec_mid", "checked_utc"]
ALERT_COLS = ["dayobs", "time_utc", "mjd_tai", "tight", "sep_arcsec", "dra_arcsec", "ddec_arcsec",
              "matched_on", "band", "mag", "snr", "reliability", "trailLength", "pixelFlags_saturated",
              "ra", "dec", "diaObjectId", "diaSourceId", "visit", "detector", "lasair_url", "checked_utc"]


def iso_utc(mjd_utc: float) -> str:
    return (J.MJD0 + dt.timedelta(days=mjd_utc)).strftime("%Y-%m-%dT%H:%M:%SZ")


def meta(**extra) -> dict:
    sha = os.environ.get("GITHUB_SHA")
    if not sha:
        try:
            sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                                 cwd=Path(__file__).parent, timeout=5).stdout.strip() or None
        except Exception:
            sha = None
    return dict(schema=SCHEMA, generated_utc=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                commit=sha, **extra)


def night_row(r: dict) -> dict:
    tr = r["track"]
    up = bool(tr.get("ra"))
    mid = len(tr["ra"]) // 2 if up else None
    return dict(dayobs=r["dayobs"], status=r["status"], n_new_objects=r["n_new_objects"],
                nearest_alert_deg=r["nearest_alert_deg"], n_in_boxes=r["n_in_boxes"],
                n_match=r["n_match"], n_tight=r["n_tight"],
                track_start_utc=iso_utc(tr["mjd_utc"][0]) if up else None,
                track_end_utc=iso_utc(tr["mjd_utc"][-1]) if up else None,
                ra_mid=round(tr["ra"][mid], 3) if up else None,
                dec_mid=round(tr["dec"][mid], 3) if up else None,
                checked_utc=r["checked_utc"])


def alert_row(r: dict, m: dict) -> dict:
    row = {k: m.get(k) for k in ALERT_COLS}
    row.update(dayobs=r["dayobs"], checked_utc=r["checked_utc"],
               time_utc=iso_utc(m["mjd_tai"] - J.TAI_MINUS_UTC),
               diaObjectId=str(m["diaObjectId"]),
               diaSourceId=str(m["diaSourceId"]) if m.get("diaSourceId") is not None else None)
    return row


def write_csv(path: Path, rows: list[dict], cols: list[str]):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r[k]) for k in cols})


def sky_track(horizons_id: str, d0: dt.date, d1: dt.date) -> list[dict]:
    """Daily position as seen from Rubin (X05) at 04:00 UTC, roughly local midnight."""
    params = dict(format="json", COMMAND=f"'{horizons_id}'", CENTER=f"'{J.SITE}'", MAKE_EPHEM="'YES'",
                  EPHEM_TYPE="'OBSERVER'", START_TIME=f"'{d0} 04:00'", STOP_TIME=f"'{d1} 04:00'",
                  STEP_SIZE="'1d'", QUANTITIES="'1'", CSV_FORMAT="'YES'", ANG_FORMAT="'DEG'", CAL_FORMAT="'CAL'")
    r = requests.get(J.HORIZONS_API, params=params, timeout=120)
    r.raise_for_status()
    text = r.json()["result"]
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons error:\n{text[:1000]}")
    out = []
    for line in text.split("$$SOE")[1].split("$$EOE")[0].splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) >= 5:
            day = dt.datetime.strptime(f[0].split()[0], "%Y-%b-%d").date()
            out.append(dict(date=(day - dt.timedelta(days=1)).isoformat(),  # 04:00 UTC belongs to the previous dayObs
                            ra=round(float(f[3]), 3), dec=round(float(f[4]), 3)))
    return out


def publish(out_root: Path, tgt: dict, today: dt.date | None = None):
    base = Path(out_root) / tgt["slug"]
    recs = [json.loads(p.read_text()) for p in sorted((base / "nights").glob("*.json"))]
    if not recs:
        return
    demo = next((r["demo"] for r in recs if r.get("demo")), None)
    m = meta(target=tgt["slug"], **({"demo": demo} if demo else {}))
    nights = [night_row(r) for r in recs]
    alerts = sorted((alert_row(r, a) for r in recs for a in r["matches"]), key=lambda a: a["mjd_tai"])

    # every night ever checked; every alert ever matched
    write_csv(base / "nights.csv", nights, NIGHT_COLS)
    (base / "nights.json").write_text(json.dumps(dict(meta=m, nights=nights), indent=0))
    write_csv(base / "alerts.csv", alerts, ALERT_COLS)
    (base / "alerts.json").write_text(json.dumps(dict(meta=m, alerts=alerts), indent=1))

    # quick reads
    last = recs[-1]
    tight = [a for a in alerts if a["tight"]]
    loose = [a for a in alerts if not a["tight"]]
    pick = lambda a: a and {k: a[k] for k in ("dayobs", "time_utc", "sep_arcsec", "band", "mag", "lasair_url")}
    with_alerts = [n for n in nights if n["nearest_alert_deg"] is not None]
    closest = min(with_alerts, key=lambda n: n["nearest_alert_deg"], default=None)
    latest = dict(
        meta=m, target={k: tgt[k] for k in ("slug", "name")},
        last_night=dict(night_row(last), matches=[alert_row(last, a) for a in last["matches"]]),
        last_match=pick(tight[-1] if tight else None),
        last_candidate=pick(loose[-1] if loose else None),
        closest_call=closest and {k: closest[k] for k in ("dayobs", "nearest_alert_deg", "status")},
        totals=dict(first_night=nights[0]["dayobs"], nights_checked=len(nights),
                    nights_with_alerts=len(with_alerts),
                    nights_covered=sum(n["n_in_boxes"] is not None for n in nights),
                    n_detections=len(tight), n_candidates=len(loose)))
    (base / "latest.json").write_text(json.dumps(latest, indent=1))
    (base / "week.json").write_text(json.dumps(dict(meta=m, nights=nights[-WEEK:]), indent=1))

    # sky map: the whole history (first checked night -> today) plus SKY_DAYS ahead
    today = today or J.last_finished_night()
    d0 = dt.date.fromisoformat(recs[0]["dayobs"])
    def tiles(rs):  # 1-deg cells -> [n_nights, n_new_objects]
        cells = {}
        for r in rs:
            for ra, dec, n in r["footprint"]:
                c = cells.setdefault((ra, dec), [0, 0])
                c[0] += 1
                c[1] += n
        return [[ra, dec, k, n] for (ra, dec), (k, n) in sorted(cells.items())]
    recent = [r for r in recs if dt.date.fromisoformat(r["dayobs"]) > today - dt.timedelta(days=SKY_DAYS)]
    status = {n["dayobs"]: n for n in nights}
    one = dt.timedelta(days=1)  # positions at D 04:00 UTC belong to dayObs D-1
    track = sky_track(tgt["horizons_id"], d0 + one, today + dt.timedelta(days=SKY_DAYS) + one)
    for p in track:
        n = status.get(p["date"])
        if n:
            p.update(status=n["status"], nearest_alert_deg=n["nearest_alert_deg"])
    sky = dict(meta=m, start=d0.isoformat(), today=today.isoformat(), days=SKY_DAYS, track=track,
               footprint=tiles(recs), footprint_recent=tiles(recent),
               footprint_cols=["ra_lo", "dec_lo", "n_nights", "n_new_objects"],
               hits=[{k: a[k] for k in ("dayobs", "time_utc", "ra", "dec", "tight", "sep_arcsec", "band")}
                     for a in alerts],
               closest_call=latest["closest_call"])
    (base / "sky.json").write_text(json.dumps(sky))

    # target list for the website
    tf = Path(out_root) / "targets.json"
    known = {t["slug"]: t for t in (json.loads(tf.read_text())["targets"] if tf.exists() else [])}
    known[tgt["slug"]] = {k: tgt[k] for k in ("slug", "name", "description")}
    tf.write_text(json.dumps(dict(meta=meta(), targets=list(known.values())), indent=1))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="output")
    p.add_argument("--target", help="slug from targets.json (default: every target with data)")
    p.add_argument("--horizons-id", help="override the target's Horizons ID (for the demo)")
    a = p.parse_args(argv)
    targets = json.loads((Path(__file__).parent / "targets.json").read_text())
    for t in targets:
        if a.target in (None, t["slug"]) and (Path(a.out) / t["slug"] / "nights").exists():
            if a.horizons_id:
                t = dict(t, horizons_id=a.horizons_id)
            publish(Path(a.out), t)
            print(f"published {a.out}/{t['slug']}")


if __name__ == "__main__":
    main()
