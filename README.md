<p align="center"><img src="logo.svg" alt="tdarrflix logo" width="96"></p>

# tdarr-dashboard

<p align="center">
  <img alt="Release" src="https://img.shields.io/github/v/release/oleh11/tdarr-dashboard?style=for-the-badge&label=RELEASE&labelColor=3a3f44&color=0e1114">
  <img alt="License" src="https://img.shields.io/github/license/oleh11/tdarr-dashboard?style=for-the-badge&label=LICENSE&labelColor=3a3f44&color=ffffff">
  <img alt="Node" src="https://img.shields.io/badge/NODE-18%2B-3c873a?style=for-the-badge&labelColor=3a3f44&logo=nodedotjs&logoColor=white">
  <img alt="Tdarr" src="https://img.shields.io/badge/TDARR-3.x-1d9bf0?style=for-the-badge&labelColor=3a3f44">
  <img alt="Dependencies" src="https://img.shields.io/badge/DEPENDENCIES-0-d98e04?style=for-the-badge&labelColor=3a3f44">
  <img alt="Encoders" src="https://img.shields.io/badge/ENCODERS-NVENC%20%C2%B7%20QSV-2fb4a4?style=for-the-badge&labelColor=3a3f44">
</p>

A small Plex-style status page for [Tdarr](https://home.tdarr.io/). It shows what is transcoding right now, the queue, recent conversions with posters, space saved, and an optional estimate of the electricity used and the disk space you avoided buying.

- Single file server (`server.js`) with no dependencies, plus one static page (`index.html`)
- Needs Node 18 or newer
- Read-only: it only reads Tdarr's API (and Radarr/Sonarr for posters, if you set them)

## Run it

```sh
cp .env.example .env      # then edit it
export $(grep -v '^#' .env | xargs)
node server.js
```

Open `http://localhost:8080`.

To reach it from other machines, set `HOST=0.0.0.0`. The page has no login, so keep it on your LAN or put it behind a reverse proxy with authentication.

## Configuration

All settings are environment variables (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `8080`, `127.0.0.1` | Where the dashboard listens |
| `TDARR_URL` | `http://localhost:8265` | Your Tdarr server |
| `TDARR_KEY` | empty | Tdarr API key, if auth is enabled |
| `RADARR_URL`, `RADARR_KEY` | empty | Optional, for movie posters and titles |
| `SONARR_URL`, `SONARR_KEY` | empty | Optional, for show posters (include any URL base) |
| `MEDIA_DIRS`, `TV_DIR` | `Movies,TVShows` | Folder names used to find titles in file paths |
| `KWH_PRICE` | `0.16` | Your electricity price per kWh |
| `DRIVE_PRICE`, `DRIVE_TB` | `700`, `24` | Price and size of a new drive, to value freed space |
| `POWER_BASE_W`, `POWER_PER_WORKER_W` | `60`, `30` | Extra watts per active node, and per active worker |
| `POWER_LIGHT_NODES`, `POWER_LIGHT_NODE_W` | empty, `55` | Comma-separated node names that draw a flat wattage |

## Resource tiles and vendor badges (optional)

Under the header there are tiles for the PC's graphics card, processor, an estimated total power draw, the server's CPU and disk wait, and the conversion pace. Each tile and each "now transcoding" card gets an NVIDIA, Intel or AMD badge. Node badges come from the node name in Tdarr (a name containing `rtx`/`nvidia`, `intel` or `amd` is enough), so naming your nodes e.g. `PC-RTX5080` and `NAS-Intel` makes it work.

- The server tile reads `/proc`, so it only appears when the dashboard runs on Linux.
- For the PC tiles, run `pc-stats-push.js` on the transcoding PC. It needs `nvidia-smi` and sends the numbers to the dashboard every few seconds:

```sh
DASHBOARD_URL=http://your-server:8080 node pc-stats-push.js
```

The dashboard must listen on an address the PC can reach (`HOST=0.0.0.0`). Only the GPU draw is measured. The CPU and rest-of-system watts are estimates you can tune with `PC_CPU_IDLE_W`, `PC_CPU_LOAD_W` and `PC_SYSTEM_W`.

The "left" figure counts queued plus in-progress files, with a time estimate from the last hour's pace (it appears after about ten minutes of running).

## About the power estimate

It is a rough estimate, not a measurement. The dashboard adds up the watts you configure for each active node, over time, and multiplies by `KWH_PRICE`. For a better number, measure your hardware with a power meter and set the watt values to match. The running total is stored in `energy.json` next to the server.

## License

MIT
