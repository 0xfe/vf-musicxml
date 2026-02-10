# LilyPond Demo Track

This directory tracks demo coverage against the LilyPond MusicXML collated suite.

- Suite index: `https://lilypond.org/doc/v2.25/input/regression/musicxml/collated-files.html`
- Manifest: `/Users/mo/git/musicxml/demos/lilypond/manifest.json`

The manifest is the planning bridge between:
- user-facing demo pages under `/Users/mo/git/musicxml/demos/site/`
- conformance fixtures under `/Users/mo/git/musicxml/fixtures/conformance/`
- full-suite M7 end goal in `/Users/mo/git/musicxml/plan.md`

## Update flow
1. Download/refresh canonical suite fixture(s) into `/Users/mo/git/musicxml/demos/scores/`.
2. Add seeded demo entries in `manifest.json`.
3. Update category status/notes in `manifest.json`.
4. Run `npm run demos:build` and verify `demos/site/lilypond-roadmap.html`.
5. If behavior changed, add or update conformance fixture metadata and tests.
