## About

The [NSF-DOE Vera C. Rubin Observatory's](https://rubinobservatory.org) landmark Legacy Survey of Space and Time (LSST), conducted on the unique Simonyi Survey Telescope, will revolutionize modern "survey astronomy", including the census and study of our solar system. Likewise, Rubin has the capacity to transform our search for technosignatures (also known as SETI: the Search for Extraterrestrial Intelligence), studying billions of objects both near and far in near real time.

Examining known, human-made technology is an important checkpoint in our search for the unknown and potentially extraterrestrial. [JWST](https://science.nasa.gov/mission/webb/) represents an ideal test case: it is bright, nearby and distinctly artificial (e.g. in color, motion, and brightness variation). JWST will be easily detected in Rubin data, particularly the nightly Alerts shared with the community. However, the Minor Planet Center (*the* authority on tracking minor bodies in the solar system) [does not keep a public repository of artificial satellites](https://docs.minorplanetcenter.net/mpc-ops-docs/miscellaneous/artsat-obs-policy/), meaning JWST detections by Rubin may repeatedly be temporarily confused with a bona fide near Earth object or asteroid. 

**Plus it's just kind of cool to point one incredible telescope at another.**

## How it works

- After each night of Rubin observing, we run a series of small scripts.
- [JPL/Horizons](https://ssd.jpl.nasa.gov/horizons/app.html) is used to get JWST's position as seen from Rubin every 5 minutes throughout the night.
- With the [Lasair](https://lasair.lsst.ac.uk/) alert broker we count *new* alert objects (i.e. **not** known variable objects) in a 1x1° grid over the sky for the night.
- If any new alerts are within a few degrees, we check all nearby alerts against JWST's predicted position at its detection time. Within 2 arcseconds is called a "detection" here, while 2–20 arcseconds is a loose candidate.


## Known Issues

- JWST may pass through areas of sky that Rubin is imaging but not currently sending alerts for (e.g. does not have templates prepared yet). This will become rare after the first year of LSST. Additional detections of JWST by Rubin will be recoverable in full data releases, rather than the Alert stream.
- JWST could overlap a known moving object or variable source, causing Rubin or Lasair to mistakenly link an alert to an old target, or miss JWST entirely.
- Rubin didn't issue an alert because JWST is saturated, masked (e.g. near a bad pixel or bright source), or is in a very dense field and the alert pipelines may not have run correctly for a variety of other reasons.

## Data

The product of our nightly scripts are stored in the `output/` folder of the repository. `nights.csv` (every night checked) and `alerts.csv` (every matched alert).

All data is drawn from publicly available sources, including the Rubin Observatory, Lasair-LSST broker, and JPL Horizons. No proprietary access to any facility or datastream has been used.  Real people have worked hard on these products and missions, and if you enjoyed this website you should really go thank them!

## Credits

This project was started at the LSST Solar System Science Collaboration's [Nov 2026 Sprint](https://lsst-sssc.github.io/SprintSeattle2026/). The scripts and website were designed by [James Davenport](https://jradavenport.github.io/) in collaboration with [Steve Croft](https://www.physics.ox.ac.uk/our-people/crofts) and [Colin Orion Chandler](https://colinchandler.com), and helpful input from many SSSC members! Code for the project was generated with support from AI, which can *and does* make mistakes and silly choices.

This project is intended for educational and entertainment purposes only, and has not been independently peer-reviewed. While we have attempted to be as accurate as possible, and adopt best practices for matching bright moving objects, we make no promise that the detection history for JWST by Rubin presented here is complete. Research users should consult the latest Rubin/LSST data releases and ephemeris from JPL/Horizons.
