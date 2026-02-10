# Demos

This directory contains small reference demos that are rendered from tracked MusicXML files.

## Files
- `scores/*.musicxml`: demo source scores.
- `site/`: generated static HTML pages (created by build script; not committed).

## Build demos
```bash
cd /Users/mo/git/musicxml
npm run demos:build
```

## View demos locally
```bash
cd /Users/mo/git/musicxml
npm run demos:serve
```

Then open:
- `http://localhost:4173/`

You can change the port with `DEMO_PORT`:
```bash
DEMO_PORT=5180 npm run demos:serve
```

## Adding new demos
1. Add a new score under `demos/scores/`.
2. Add a new definition entry in `/Users/mo/git/musicxml/scripts/build-demos.mjs`.
3. Run `npm run demos:build` and verify the generated page.
4. Keep adding milestone-relevant demos as new features land.
