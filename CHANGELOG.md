# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- SolaX inverters read over the local network, through the Pocket WiFi or
  Pocket LAN dongle (X-Hybrid, X1 and X3 G3, X1 Boost / Mini, X1 Smart,
  X1 Hybrid G4, X3 Hybrid G3 and G4, Q.VOLT HYB-G3-3P, X3 MIC PRO G2,
  X3 Ultra, X1 Lite LV), with automatic model detection and a clear message
  for a model not known yet.
- One device per inverter: PV power (total and per string), production today,
  total production index, AC power, grid exchange and grid indexes, battery
  level, charge and discharge power, temperatures, inverter state, online.
- SolaX Cloud as an option for the dongles that do not answer locally, within
  the API quota (every 5 minutes at most, 10 calls a minute).
- Dashboard widget "Solar overview", scene trigger "Inverter state changed",
  scene action "Get the solar summary", and a "Test the connection" button.
- Texts and documentation in English, French, German and Spanish.
- `scripts/probe.mjs`, a read-only probe of a dongle or of SolaX Cloud.

[Unreleased]: https://github.com/guim31/gladys-solax/commits/main
