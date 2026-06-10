# Signalro

[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-r160-000000.svg?logo=three.js&logoColor=white)](https://threejs.org)
[![Tests](https://img.shields.io/badge/tests-31%20passing-2ea44f.svg)](#testing)
[![Dependencies](https://img.shields.io/badge/runtime%20deps-1%20(ws)-blue.svg)](package.json)

**A 3D visualizer for your machine's live network traffic — every packet
becomes a vehicle on a night highway.** Outbound packets drive away from you on
the left carriageway; inbound packets come toward you on the right. Built with
Three.js and a single Node dependency.

▶️ **[Try the live demo →](https://flint-knoll-me7j.here.now)** &nbsp;·&nbsp;
📖 **[Documentation site →](https://sunny-cottage-dd88.here.now)** &nbsp;·&nbsp;
📋 **[Full reference →](DOCUMENTATION.md)**

> The live demo runs entirely in your browser (no install, no capture server) —
> it shows simulated traffic across all 26 scenes. Run Signalro locally to
> watch your machine's **real** packets.

[![Signalro — the default night highway (click to launch the live demo)](docs/images/night.png)](https://flint-knoll-me7j.here.now)

| Protocol | Vehicle |
| --- | --- |
| HTTPS (TCP 443) | semi truck (green container) |
| QUIC (UDP 443) | red sports car |
| HTTP (TCP 80) | delivery van |
| generic TCP | blue sedan |
| DNS (53/5353) | amber motorcycle |
| generic UDP | orange hatchback |
| SSH (TCP 22) | black SUV |
| ICMP (ping) | ambulance |
| everything else | purple bus |

Packet size scales the vehicle. Drag to orbit, scroll to zoom.

Interactions:

- **Click a vehicle** to inspect its packet (hostname/IP, ports, protocol,
  size); click empty road to dismiss.
- **Click a legend chip** to hide that protocol; **alt-click** to show only
  that protocol.
- **Exit signs** on the right shoulder name the top remote destinations
  (offline org/country lookup from `public/geoip.json`); hostnames come from
  server-side cached reverse DNS.
- **HUD sparkline** shows the last 60 s of pkt/s and KB/s.
- **🔇 sound** toggles a procedural engine hum that follows traffic intensity
  (off by default); ambulances (ICMP) blip a tiny siren.
- A connection's packets drive as a **convoy**: same lane, same speed, evenly
  spaced — a download reads as a line of trucks.

## Themes

The surroundings are switchable via the dropdown in the top-right (persisted,
or `/?theme=<key>`): `night` (default), `hawaii` (sunset coast), `autobahn`
(overcast Germany with gantry signs and wind turbines), `bigcity` (neon Vice
City), `ocean` (causeway between nav buoys, cargo ships, lighthouse), `rome`
(Colosseum and umbrella pines), plus movie-inspired scenes: `fury` (desert
mesas), `neon` (cyberpunk rain), `grid` (cyan wireframe world), `snow`
(mountain pass with falling snow), `jungle` (gated tropical island), `mars`
(red planet with habitat domes), `gotham` (gothic towers and a searchlight),
`west` (canyon sunset), `space` (starfield causeway with a ring station), and
`shire` (green hills with round doors). Rain, snow, turbines, searchlight, and
the station ring are animated. All scenes are procedural low-poly geometry —
no external assets.

### Fleets

Some themes swap the cars for a matching fleet — same nine protocol slots, so
the legend, filters, tooltips, and convoys carry over: `ocean` → boats
(container ship, speedboat, ferry, sailboat, jet ski…), `space` → spacecraft,
and ten non-car scenarios: `reef` → fish (Under the Sea), `sky` → aircraft
(Above the Clouds), `rails` → trains (Midnight Express), `savanna` → animals
(Pride Lands), `arctic` → polar animals with an animated aurora (Penguin
March), `dino` → dinosaurs (Valley of Giants), `magic` → dragons, brooms, and
ghosts (Wizard's Night), `christmas` → sleighs and snowmen (Santa's Run),
`depths` → submarines among hydrothermal vents (Silent Depths), and `skyfair`
→ balloons and zeppelins (Up & Away). Boats bob, fliers hover, animals trot.

## Run

```bash
npm install
sudo npm start        # sudo needed for live packet capture on macOS
```

Then open http://localhost:8090.

### One-command run

```bash
npx signalro          # once published to npm; or `node bin/signalro.js` from a clone
```

Or with Docker (no Node/tcpdump install needed):

```bash
docker build -t signalro .
docker run --rm --net=host --cap-add=NET_RAW --cap-add=NET_ADMIN signalro
# open http://localhost:8090   (omit the flags to just explore demo mode)
```

Without `sudo` the server still runs, but tcpdump can't open the BPF devices,
so the page automatically switches to simulated **demo traffic** (also
toggleable with the button in the top-right, or by opening `/?demo`).

To capture live packets **without sudo**, grant your user BPF access once
(the same `access_bpf` group approach Wireshark uses — creates the group,
adds you, and installs a LaunchDaemon so it survives reboots):

```bash
sudo scripts/grant-bpf.sh     # then open a new terminal and: npm start
sudo scripts/grant-bpf.sh uninstall   # to undo
```

Options:

- `PORT=9000 sudo -E npm start` — change the web port
- `IFACE=en1 sudo -E npm start` — capture a specific interface (default: the
  interface of your default route, usually `en0`)

### Linux

Works the same; the default interface is detected via `ip route show default`.
Live capture needs privileges — either run with `sudo`, or grant tcpdump
capture capabilities once and run unprivileged:

```bash
sudo setcap cap_net_raw,cap_net_admin+eip "$(command -v tcpdump)"
npm start
```

### Windows

Install [npcap](https://npcap.com/) with its WinDump/tcpdump-compatible tools,
then run from an Administrator terminal. List devices with `windump -D` and pick
one by index:

```powershell
$env:IFACE = "1"        # device index from `windump -D`
npm start
```

Override the binary with `CAPTURE_BIN` if your tcpdump build is named
differently; its output is parsed the same as tcpdump.

### Remote / headless capture

Run the server on a Pi, router, or remote box and watch from any browser. Gate
the live stream with a shared token:

```bash
SIGNALRO_TOKEN=choose-a-secret HOST=0.0.0.0 sudo -E npm start
# then open  http://that-host:8090/?token=choose-a-secret
```

Without the token the page loads but receives no packet data. `HOST` sets the
bind address (default `0.0.0.0`).

### Export

The **⊞ Connections & export** panel downloads the current session as **CSV**
(flow summary, works everywhere) or **PCAP** (Wireshark-openable; needs live
capture — the server keeps a rolling buffer).

## How it works

- `server.js` spawns `tcpdump -i <iface> -n -q -l -t -U`, parses each line
  (protocol, ports, length), classifies it (port → protocol family), decides
  direction by comparing the source address against the machine's local
  addresses, and streams batches to the browser over WebSocket every 100 ms.
  Packets are tagged with a flow id (normalized 5-tuple; idle flows evicted
  after 30 s) so the client can group a connection's packets into a convoy:
  same lane, same speed, evenly spaced.
- `public/main.js` renders the highway with Three.js. Vehicles are low-poly
  models built from merged colored boxes and drawn with `InstancedMesh` (two
  draw calls per vehicle type), so hundreds of simultaneous vehicles stay
  smooth. Headlights/taillights are unlit geometry so they glow at night.

For a deep dive on architecture, the capture pipeline, flow convoys, the theme
engine, and how to add your own scene or fleet, see **[DOCUMENTATION.md](DOCUMENTATION.md)**.

## Gallery

| | | |
|---|---|---|
| ![Hawaii](docs/images/hawaii.png) **Hawaii Coast** | ![Autobahn](docs/images/autobahn.png) **German Autobahn** | ![Vice City](docs/images/bigcity.png) **Vice City** |
| ![Open Ocean](docs/images/ocean.png) **Open Ocean** (boats) | ![Star Gate](docs/images/space.png) **Star Gate** (spacecraft) | ![Under the Sea](docs/images/reef.png) **Under the Sea** (fish) |
| ![Pride Lands](docs/images/savanna.png) **Pride Lands** (animals) | ![Valley of Giants](docs/images/dino.png) **Valley of Giants** (dinosaurs) | ![Santa's Run](docs/images/christmas.png) **Santa's Run** |
| ![Neon Rain](docs/images/neon.png) **Neon Rain** | ![The Grid](docs/images/grid.png) **The Grid** | ![Up & Away](docs/images/skyfair.png) **Up & Away** (balloons) |

All 26 scenes and their fleets are catalogued in [DOCUMENTATION.md](DOCUMENTATION.md#themes--fleets).

## Testing

```bash
npm test     # 31 unit tests (parser, classifier, flow table, reverse DNS)
npm run check # syntax-checks the server and all ES modules
```

The browser-facing features (picking, filters, themes, fleets, sparkline) are
verified with headless Playwright scripts during development.

## Contributing

Issues and pull requests are welcome. Adding a new scene is a ~20-line theme
spec in `public/themes.js`; adding a new fleet is a table of nine vehicle
definitions in `public/fleets.js` — see the
[DOCUMENTATION.md](DOCUMENTATION.md#extending-signalro) walkthrough.

## License

[MIT](LICENSE) © 2026 Thorsten Meyer.

Signalro bundles no third-party assets — every vehicle, prop, and scene is
procedural low-poly geometry generated at runtime. Three.js is loaded from a
CDN at the version pinned in `public/index.html`.
