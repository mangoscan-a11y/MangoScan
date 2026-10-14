# MangoScan Web

Dashboard and local server for the MangoScan automated mango sorting system. It runs fully offline on one laptop: the server talks to the ESP32 boards over USB, stores data in a local MongoDB, and serves this dashboard.

**Stack:** Vite + React + TypeScript + Tailwind + shadcn/ui (dashboard), Node + Express + MongoDB + serialport (server).

## Quick start

```bash
npm install
npm run build
npm run db:seed              # database, indexes, reference data (needs MongoDB running)
npm run machine:mock         # try it with simulated boards and models
```

Open http://localhost:4000. With the real boards plugged in: `npm run machine`.

Full setup, test-day checklist and troubleshooting are in `docs/guide.md`. The ESP32 firmware, wiring and wire protocol are in `../Firmware/README.md`.

## Scripts

| Script | What it does |
|---|---|
| `npm run machine` | models service + server (real ESP32s, simulated models) |
| `npm run machine:mock` | same, simulated ESP32s |
| `npm run server` / `server:mock` | server only |
| `npm run dev` | Vite dev server (proxies `/api` to the server on :4000) |
| `npm run db:seed` | prepare MongoDB (`--sample[=N]`, `--clear-scans --yes`) |
| `npm run simulator` | post made-up scans to the running server |
| `npm test`, `npm run lint`, `npm run build` | checks |

Configuration is optional: copy `.env.example` to `.env` to change ports, the serial ports or the MongoDB connection.
