# LilyPond MusicXML Suite Tips

## Canonical suite entry points
- Collated suite index:
  - `https://lilypond.org/doc/v2.25/input/regression/musicxml/collated-files.html`
- Most fixture links in the collated page resolve to hashed paths such as:
  - `https://lilypond.org/doc/v2.25/input/regression/musicxml/4a/lily-17c6267f.xml`

## Download pattern
Use direct fixture URLs from the collated page:

```bash
curl -L --fail https://lilypond.org/doc/v2.25/input/regression/musicxml/4a/lily-17c6267f.xml \
  -o /Users/mo/git/musicxml/demos/scores/lilypond-01c-pitches-no-voice.musicxml
```

Notes:
- Keep downloaded demo files under `/Users/mo/git/musicxml/demos/scores/`.
- Preserve a source URL mapping in:
  - `/Users/mo/git/musicxml/scripts/build-demos.mjs`
  - `/Users/mo/git/musicxml/demos/lilypond/manifest.json`

## Coverage workflow
1. Seed one or more demo files from LilyPond fixture URLs.
2. Promote related conformance fixtures under `/Users/mo/git/musicxml/fixtures/conformance/`.
3. Update category status in `/Users/mo/git/musicxml/demos/lilypond/manifest.json`.
4. Rebuild demos and inspect:
   - `npm run demos:build`
   - `http://localhost:4173/lilypond-roadmap.html`
5. Keep plan/todo state in sync:
   - `/Users/mo/git/musicxml/plan.md`
   - `/Users/mo/git/musicxml/todo.md`

## Why this matters
- Demo credibility: users can compare behavior against known suite fixtures instead of hand-crafted samples.
- Triage speed: each demo links back to an official source fixture.
- End-goal alignment: demo roadmap categories mirror the same LilyPond suite that drives M7 conformance.
