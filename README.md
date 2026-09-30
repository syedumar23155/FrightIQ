# FreightIQ Satellite Map

also for gods eye., the map sould be real map
and satellie view like google maps features

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2a5a3bff-3cc1-4b20-b225-c33b1fe5613b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Google Maps setup

Set `VITE_GOOGLE_MAPS_API_KEY` in the local `.env` file to your Google Maps JavaScript API browser key. Restrict the key in Google Cloud to the Maps JavaScript API and your website referrers. The app loads Google Maps first and keeps its interactive Esri satellite fallback if Google Maps cannot load.

## Live AIS service (optional)

The app includes a separate long-running AIS backend because the existing
Cloudflare-targeted frontend does not host background WebSocket consumers.
The backend keeps the AISStream key server-side and exposes only normalized
vessel, status, port and heuristic congestion data over `/api/ais/*`. Vite
proxies those paths to the local service during development.

1. Create/sign in to AISStream with GitHub and generate an API key at
   [aisstream.io](https://aisstream.io/).
2. Add `AISSTREAM_API_KEY=...` to the project's local `.env` file (create it
   only if it does not exist). Do not use a `VITE_` prefix or commit the secret.
3. In one terminal run `bun run ais:service`.
4. In another terminal run `bun run dev`.
5. Open **Risk & Port Constraints**. A connected feed shows **LIVE AIS** and
   refreshes every 15 seconds. Without a key/service, the page says live AIS is
   unavailable and keeps demo estimates labelled as simulated.
6. Check `http://127.0.0.1:8790/api/ais/status` (or the same `/api/ais/status`
   path through the Vite app origin) for connection status.

The service subscribes to focused East Coast approach boxes, not the global
feed. It keeps unique MMSIs and stationary state in process memory only; a
service restart clears observation history, so a new >48-hour heuristic flag
requires fresh observations. Active count uses a configurable two-hour last-seen
window. A potential stationary flag requires repeated low-speed observations
within 1 km for more than 48 hours, with no observation gap over six hours.
These are heuristic indicators, not confirmed congestion. Static ship name,
type and destination fields appear only when AISStream supplies them.

Port definitions and active/stationary thresholds are documented in
`src/server/ais-core.ts`. The eleven monitored areas are Paradip,
Visakhapatnam, Gangavaram, Gopalpur, Haldia, Kakinada, Chennai,
Ennore/Kamarajar, Kolkata, Sagar-Sandheads and Dhamra. Each AIS position is
assigned to its nearest monitored port area to avoid double-counting across
overlapping radii. No MongoDB or Redis is configured or introduced.
`AIS_MODE=mock` provides explicitly simulated records for local UI development;
it does not simulate a live feed or a 48-hour history.

To preview the explicit mock state on Windows PowerShell, stop the default AIS
service, then run `$env:AIS_MODE="mock"; bun run ais:service` before opening
the dashboard. For a live local feed, clear `AIS_MODE` and restart the service.
The `/api/ais/*` Vite proxy is for local development; a production deployment
must provide a secured ingress route from `/api/ais/*` to the separately hosted
AIS service.

Run the AIS logic checks with `bun run test:ais`.
