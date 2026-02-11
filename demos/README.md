# Demos

This directory contains reference demos rendered from authoritative MusicXML fixtures.

## Files
- `scores/*.musicxml`: tracked demo source scores.
- `lilypond/manifest.json`: suite roadmap and category coverage plan.
  - `categoryStatus` in this manifest is demo-seeding progress only.
  - Conformance completion is derived from `fixtures/conformance/lilypond/*.meta.yaml`.
- `../fixtures/corpus/lilypond-collated-v2.25.json`: canonical LilyPond corpus index used by roadmap/demo validation.
- `lilypond/README.md`: update workflow for LilyPond-based demo expansion.
- `site/`: generated static HTML pages (created by build script; not committed).

Current seeded demo sources:
- `lilypond-01a-pitches-pitches.musicxml` (from `01a-Pitches-Pitches.xml`)
- `lilypond-01c-pitches-no-voice.musicxml` (from `01c-Pitches-NoVoiceElement.xml`)
- `lilypond-02a-rests-durations.musicxml` (from `02a-Rests-Durations.xml`)
- `lilypond-03a-rhythm-durations.musicxml` (from `03a-Rhythm-Durations.xml`)
- `lilypond-11a-time-signatures.musicxml` (from `11a-TimeSignatures.xml`)
- `lilypond-13a-key-signatures.musicxml` (from `13a-KeySignatures.xml`)
- `lilypond-61a-lyrics.musicxml` (from `61a-Lyrics.xml`)
- `lilypond-71g-multiple-chordnames.musicxml` (from `71g-MultipleChordnames.xml`)

Build output now includes:
- full LilyPond conformance demo pages (`lilypond-*`, one page per active fixture).
- selected complex real-world score demos (`realworld-*`, medium/large/long-form focus).
- seeded demos remain explicitly highlighted as the quick-review subset.

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
1. Refresh corpus index (if suite version changed or if you want a fresh source map):
   - `npm run corpus:lilypond:sync`
2. Download canonical source score(s) under `demos/scores/` (prefer LilyPond suite cases).
3. Add or update seeded entries in `/Users/mo/git/musicxml/demos/lilypond/manifest.json`.
4. Update `categoryStatus` notes in `/Users/mo/git/musicxml/demos/lilypond/manifest.json`.
5. Run `npm run demos:build` and verify both `index.html` and `lilypond-roadmap.html`.
6. Keep promoting demos and conformance fixtures together as milestones advance.
