# tdarr-dashboard

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

## About the power estimate

It is a rough estimate, not a measurement. The dashboard adds up the watts you configure for each active node, over time, and multiplies by `KWH_PRICE`. For a better number, measure your hardware with a power meter and set the watt values to match. The running total is stored in `energy.json` next to the server.

## License

MIT
