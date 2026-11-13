# Data products

Written by `jwst_alerts.py` (per-night records) and `publish.py` (everything else, rebuilt from
the per-night records on every run). One folder per target; JWST is `jwst/`.

Conventions:
- **dayobs**: Rubin night label; night D runs from D 12:00 UTC to D+1 12:00 UTC.
- Times: `*_utc` ISO 8601 UTC; `mjd_tai` Modified Julian Date in TAI (TAI = UTC + 37 s).
- Angles in degrees unless the name ends in `_arcsec`. RA/Dec are ICRF.
- **New Lasair objects** = objects first detected that night. Not Rubin's total alerts.
- IDs (`diaObjectId`, `diaSourceId`) exceed 2⁵³: they are strings in the summary products;
  in `nights/` files `diaSourceId` is an integer, so read it with a parser that keeps big integers.
- Every JSON product has a `meta` block: `schema` (version), `generated_utc`, `commit` (git SHA).

## `nights.csv` / `nights.json`: every night checked
| column | meaning |
|---|---|
| `dayobs` | Rubin night |
| `status` | `JWST not up` · `no alerts` · `not covered` · `covered, no match` · `covered, loose match only` · `MATCH` |
| `n_new_objects` | new Lasair objects that night, whole sky |
| `nearest_alert_deg` | distance from JWST's track to the centre of the nearest 1° cell with a new object; empty if no alerts |
| `n_in_boxes` | objects in the search boxes along the track; empty unless covered (nearest < 3°) |
| `n_match` / `n_tight` | matches within 20″ / within 2″ |
| `track_start_utc`, `track_end_utc` | when JWST was above 20° with the Sun down |
| `ra_mid`, `dec_mid` | JWST's position at mid-track |
| `checked_utc` | when the night was last checked (each night is re-checked for 3 days) |

## `alerts.csv` / `alerts.json`: every Rubin alert matched to JWST
One row per matched detection, oldest first. Re-checking a night replaces that night's rows.
| column | meaning |
|---|---|
| `dayobs`, `time_utc`, `mjd_tai` | night and detection time |
| `tight` | true if `sep_arcsec` < 2 (a detection); false for 2–20″ (loose candidate, check by eye) |
| `sep_arcsec`, `dra_arcsec`, `ddec_arcsec` | offset from JWST's predicted position (ΔRA includes cos Dec) |
| `matched_on` | `first` or `last`: which detection time of the Lasair object was compared |
| `band`, `mag`, `snr` | filter, PSF magnitude (AB, from psfFlux in nJy), S/N |
| `reliability`, `trailLength`, `pixelFlags_saturated` | Rubin's real/bogus score, trail length (″), saturation flag |
| `ra`, `dec` | Lasair object position |
| `diaObjectId`, `diaSourceId`, `visit`, `detector` | Rubin identifiers |
| `lasair_url` | the object's Lasair page |
| `checked_utc` | when this night was last checked |

## `latest.json`, `week.json`: quick reads
`latest.json`: `last_night` (a nights row plus its `matches`), `last_match` and `last_candidate`
(most recent tight / loose match, or null), `closest_call` (night with the smallest
`nearest_alert_deg`), `totals`. `week.json`: the last 7 nights rows.

## `sky.json`: sky map
`track`: JWST's daily position from Rubin at 04:00 UTC, from `start` (the first checked night) to
`days` after `today`, with each checked night's `status` and `nearest_alert_deg`. `footprint`:
`[ra_lo, dec_lo, n_nights, n_new_objects]` per 1° cell over every checked night. `hits`: every
matched alert.

## `nights/<dayobs>.json`: one night, complete
`status`, counts and distances as above, plus:
- `track`: `mjd_utc`, `ra`, `dec`, `alt` every 5 min (Sun down, alt > 20°)
- `footprint`: `[ra_lo, dec_lo, n]` new objects per 1° cell
- `matches`: full match records (same fields as `alerts`)
