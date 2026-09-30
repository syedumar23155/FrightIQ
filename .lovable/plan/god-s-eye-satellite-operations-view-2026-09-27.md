# God’s Eye Satellite Operations View

## Goal
Build the first FreightIQ screen as an interactive command-center map using real Google satellite imagery.

## Experience
- Fill the main workspace with a satellite map centered on the Indian Ocean and India’s east coast.
- Add the five sourcing regions and seven east-coast Indian ports as distinct, selectable markers.
- Draw curved, sea-aware freight corridors with normal, rising, and high-pressure colors.
- Include map type, zoom, tilt, fullscreen, recenter, and corridor-filter controls.
- Add a compact operations rail showing active routes, pressure, ETA, vessel count, and selected-location details.
- Clearly mark synthetic operating figures as demo data; do not imply live AIS.

## Technical details
- Load Google Maps JavaScript asynchronously using `VITE_GOOGLE_MAPS_API_KEY` from the local environment.
- Use the satellite/hybrid map type, disable built-in POI clicks, and render app-owned markers and polylines.
- Keep the page usable on desktop and mobile, with keyboard-accessible controls and reduced-motion support.
- Add page-specific title, description, Open Graph metadata, and Twitter metadata.
- Verify the rendered map, controls, marker selection, corridor filtering, and mobile layout in the browser.
