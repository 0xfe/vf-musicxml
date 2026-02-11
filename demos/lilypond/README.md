# LilyPond Demo Track

This directory tracks demo coverage against the LilyPond MusicXML collated suite.

- Suite index: `https://lilypond.org/doc/v2.25/input/regression/musicxml/collated-files.html`
- Manifest: `/Users/mo/git/musicxml/demos/lilypond/manifest.json`
- Canonical corpus index: `/Users/mo/git/musicxml/fixtures/corpus/lilypond-collated-v2.25.json`

The manifest is the planning bridge between:
- user-facing demo pages under `/Users/mo/git/musicxml/demos/site/`
- conformance fixtures under `/Users/mo/git/musicxml/fixtures/conformance/`
- full-suite M7 end goal in `/Users/mo/git/musicxml/plan.md`

Important:
- `manifest.json` `categoryStatus` is demo-page seeding status, not conformance completion.
- Conformance completion is calculated from active LilyPond fixtures in `/Users/mo/git/musicxml/fixtures/conformance/lilypond/*.meta.yaml`.
- `npm run demos:build` generates demo pages for all active LilyPond conformance fixtures (not only seeded rows).
- Seeded rows are the curated featured subset shown first on the demo index.

## Update flow
1. Refresh corpus index:
   - `npm run corpus:lilypond:sync`
2. Download/refresh canonical suite fixture(s) into `/Users/mo/git/musicxml/demos/scores/`.
   - Or import conformance fixtures directly: `npm run corpus:lilypond:import -- --cases 12a,14a`
3. Add seeded demo entries in `manifest.json`.
4. Update `categoryStatus` notes in `manifest.json`.
5. Run `npm run demos:build` and verify `demos/site/lilypond-roadmap.html`.
6. If behavior changed, add or update conformance fixture metadata and tests.
