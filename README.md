# SolaX Power for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that reads **SolaX
inverters** (X1, X3, X-Hybrid, Boost, Mini, Smart, Hybrid G3/G4, Ultra, MIC PRO, Lite LV, and the
Qcells Q.VOLT rebrand) **over the local network**, through the inverter's Pocket WiFi or Pocket
LAN dongle — like the Home Assistant `solax` integration. **SolaX Cloud** is an option for the
dongles that do not answer locally. Read only.

> **Developed without the hardware: feedback welcome.** The decoding is a port of the `solax`
> library and is tested against the real dongle answers published with it, but it was never run
> against a real inverter. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-solax/issues), with the output of
> `node scripts/probe.mjs <address> [registration number]` for a model not recognized.

This project is not affiliated with SolaX Power.

## Features

- **One device per inverter**: PV power (total and per string), production today, **total
  production** (the `energy-production-sensor` index of the Gladys 5.2 energy tracking), AC
  output power, grid exchange (import +, export −) and the grid import / export indexes, the
  **battery** of the hybrids (level, charge and discharge power, temperature, charge and
  discharge indexes), the inverter temperature, the **inverter state** and an **online** flag.
- **Model detection** from the dongle's answer (13 register layouts across the firmware generations), with a
  clear message for a model not known yet; the model can also be forced.
- **Dashboard widget** "Solar overview": live tiles (production, today, grid, battery), the
  24-hour curve, and what is happening (exporting or importing, charging or discharging, state).
- **Scene trigger** _Inverter state changed_ (fault, backup EPS, standby, back to normal), and
  **scene action** _Get the solar summary_ (the last reading and a sentence ready to send).
- A **Test the connection** button, a transport badge per device (local, cloud, unreachable).
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A SolaX inverter with its **Pocket WiFi** (V2/V3) or **Pocket LAN** dongle on the same network
  as Gladys, ideally with a fixed IP address, and the dongle's **registration number** (printed
  on it), used as the local password by recent firmwares.
- For SolaX Cloud only: the **API token** of your solaxcloud.com account.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this
   repository: `https://github.com/guim31/gladys-solax` (or install **SolaX Power** from the
   catalog once it is listed).
2. In **Configuration**, enter the IP address of each dongle and its registration number; save,
   then click **Test the connection**.
3. Open the **Discover** tab and add the inverters.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- **Local**: `POST http://<dongle>/` with `optType=ReadRealTimeData&pwd=<registration number>`,
  in the body or in the query string depending on the firmware, with the
  `X-Forwarded-For: 5.8.8.8` header the 2.034+ firmwares require; `GET /api/realTimeData.htm` for
  the first X-Hybrid. The variant that answers is found once and kept in `/data`. The answer is a
  flat array of registers whose layout depends on the `type` of the inverter
  ([`src/solax/models.js`](src/solax/models.js)).
- **SolaX Cloud**: `GET https://www.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do`. SolaX
  allows **10 calls per minute and 10,000 per day** per token, and the dongle uploads every
  5 minutes: each cloud inverter is read every 5 minutes at most, the calls are spaced by 6.5 s,
  and the period stretches beyond 9,000 calls a day.
- **Refreshing**: the container polls on its own timers (10 to 60 s locally); the Gladys poll
  (`should_poll`, once a minute) is only a fallback, skipped while the timer runs — the core does
  not reliably poll external devices (GladysAssistant/Gladys#3198). Only the changed values are
  sent, with a heartbeat every 6 hours.
- **At night**, most dongles are switched off with the inverter: the device shows _Offline_, the
  devices and their features come back from `/data` after a restart, and a cumulative counter is
  never published lower than before.

## Limits

- Read only, on purpose: no work mode, charge or export setting is changed.
- Some dongles refuse the local network altogether: use SolaX Cloud (5-minute data at best).
- The grid values need the SolaX meter (CT).
- Gladys 5.2.1 does not yet derive the thirty-minute production from an external integration's
  production index for the energy dashboard.
- Developed and tested without a real inverter (see above).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
node scripts/probe.mjs 192.0.2.10 SABCDE1234       # read only, secrets masked
SOLAX_TOKEN=... SOLAX_SERIAL=... node scripts/probe.mjs --cloud
```

The tests run against the SDK's fake Gladys, fake dongles over HTTP on `127.0.0.1` and a fake
SolaX Cloud: no network. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [`squishykid/solax`](https://github.com/squishykid/solax) (MIT, Robin Wohlers-Reichel and
  contributors): the model table and register layouts ported here, and the real dongle answers
  used as test fixtures (`test/fixtures/solax`, serial numbers replaced).
- The [Home Assistant `solax` integration](https://www.home-assistant.io/integrations/solax/)
  (Apache-2.0, @squishykid, @Darsstar): the polling pace and the configuration flow.
- [evcc](https://github.com/evcc-io/evcc): the SolaX Cloud endpoint and its sign conventions.
- The Gladys Assistant [integration template and SDK](https://github.com/GladysAssistant).

## License

[Apache-2.0](LICENSE). SolaX and SolaX Power are trademarks of their owner; this project is not
affiliated with SolaX Power.
