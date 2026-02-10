# Demos

This directory contains reference demos rendered from authoritative MusicXML fixtures.

## Files
- `scores/*.musicxml`: tracked demo source scores.
- `lilypond/manifest.json`: suite roadmap and category coverage plan.
- `lilypond/README.md`: update workflow for LilyPond-based demo expansion.
- `site/`: generated static HTML pages (created by build script; not committed).

Current seeded demo sources:
- `lilypond-01c-pitches-no-voice.musicxml` (from `01c-Pitches-NoVoiceElement.xml`)
- `lilypond-71g-multiple-chordnames.musicxml` (from `71g-MultipleChordnames.xml`)

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
- `http://localhost:4173/lilypond-roadmap.html` (suite roadmap + conformance alignment)

You can change the port with `DEMO_PORT`:
```bash
DEMO_PORT=5180 npm run demos:serve
```

## Adding new demos
1. Download a canonical source score under `demos/scores/` (prefer LilyPond suite cases).
2. Add or update demo entries in `/Users/mo/git/musicxml/scripts/build-demos.mjs`.
3. Update `/Users/mo/git/musicxml/demos/lilypond/manifest.json` category status/notes.
4. Run `npm run demos:build` and verify both `index.html` and `lilypond-roadmap.html`.
5. Keep promoting demos and conformance fixtures together as milestones advance.
