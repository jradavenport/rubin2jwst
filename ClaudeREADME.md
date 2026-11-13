# Has Rubin seen JWST?

Every night, this checks whether JWST showed up in Rubin Observatory's public alert stream,
and publishes the answer as a small website.

Positions come from JPL Horizons, alerts from the [Lasair-LSST](https://lasair.lsst.ac.uk)
broker. A GitHub Action runs the check each day and updates the site.

## How it works

1. Get JWST's position as seen from Rubin every 5 minutes through the night.
2. Ask Lasair where that night's new alerts were, in 1° cells, and find the one closest to JWST.
   If nothing came within 3°, the night is "not covered" and we stop.
3. Otherwise, compare every alert near JWST's path with where JWST was at that moment.
   Within 2″ is a detection; 2–20″ is worth a look by eye.

Counts on the site are new Lasair objects (first detected that night), not Rubin's total
number of alerts.

## Files

| | |
|---|---|
| `jwst_alerts.py` | checks each night and saves one JSON file per night |
| `publish.py` | builds the summary files and site data from those nightly files |
| `targets.json` | what to look for (just JWST) |
| `output/` | the results: every night checked, every matched alert ([column guide](output/README.md)) |
| `site/` | the website (plain HTML, CSS and JavaScript) |
| `site/content/` | the site's text: `about.md` and `copy.json` |
| `.github/workflows/nightly.yml` | the daily run |

## Run it yourself

```
pip install -r requirements.txt
export LASAIR_TOKEN=...                   # your Lasair-LSST API token
python jwst_alerts.py                     # the last 3 nights
python jwst_alerts.py --night 2026-11-10  # one night
```

Each night prints one line, e.g. `2026-11-10  not covered  new objects= 13493  nearest alert 40.38°`.

To view the site locally:

```
ln -sfn ../output site/output
python -m http.server 8765 -d site        # open http://localhost:8765
```

## Setting up the daily run

1. Push this folder to a public GitHub repository.
2. Settings → Secrets and variables → Actions: add `LASAIR_TOKEN`.
3. Settings → Pages: set the source to **GitHub Actions**.
4. Actions → nightly → **Run workflow**, once, to test it.

It then runs every day at 14:00 UTC, after the night in Chile. It checks the last 3 nights
(alerts can arrive late), commits the results to `output/`, and redeploys the site.

To use your own domain, add a file named `CNAME` containing the domain, point the domain's DNS
at GitHub Pages, and enter it under Settings → Pages.

## Limitations

- Lasair leaves out detections that Rubin attributed to a known asteroid.
- Anything Rubin didn't alert on (saturated, masked, no reference image) can't be seen here.
