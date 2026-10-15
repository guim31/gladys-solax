# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the registration numbers of the dongles (the password of their
  local interface) and the SolaX Cloud API token live in the Gladys
  configuration only. They are never written to `/data` and never logged; the
  logs and the "Test the connection" report show the last four characters of a
  serial number at most. The cloud token travels in the query string of the
  SolaX Cloud API (it offers nothing else), over HTTPS.
- **`/data`** (`solax-state.json`): per configured source, the request variant
  the dongle answers, the model, the features shown, the rated power, the
  firmware version and the inverter serial number; the last value of each
  cumulative counter. No secret.
- **Network**: plain HTTP to the dongles on the local network (port 80, the
  only protocol the dongles offer), and HTTPS to `www.solaxcloud.com` when the
  cloud option is configured. The integration only ever sends
  `ReadRealTimeData`: nothing is written to the inverter.
- **Device ids**: the inverter serial number when it is reported. Otherwise a
  fingerprint of the dongle's registration number (`reg-` and the first 12 hex
  characters of `sha256('solax:' + number)`), never the number itself: an
  external id is shown in Gladys and ends up in backups, logs and exports.
  Device names show the last four characters at most. In `/data`, the cloud
  sources are keyed by that fingerprint too.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the SolaX dongles, inverters and cloud the integration talks to.
