# LilyPond MusicXML Suite Tips

## Canonical suite entry points
- Collated suite index:
  - `https://lilypond.org/doc/v2.25/input/regression/musicxml/collated-files.html`
  - `https://lilypond.org/doc/v2.24/input/regression/musicxml/collated-files.html` (golden image baseline for M8)
- Most fixture links in the collated page resolve to hashed paths such as:
  - `https://lilypond.org/doc/v2.25/input/regression/musicxml/4a/lily-17c6267f.xml`
- Generated corpus index in this repo:
  - `/Users/mo/git/musicxml/fixtures/corpus/lilypond-collated-v2.25.json`

## Golden reference sync (M8)
Build and refresh fixture-to-image golden mappings used for visual quality scoring:

```bash
cd /Users/mo/git/musicxml
npm run golden:sync
```

Outputs:
- `/Users/mo/git/musicxml/fixtures/golden/manifest.json`
- `/Users/mo/git/musicxml/fixtures/golden/lilypond-v2.24/*.png`

Notes:
- v2.24 collated images are used as primary references.
- If an active fixture is missing in v2.24 docs, sync falls back to v2.25 references and tags the manifest row as `referenceKind: lilypond-v2.25-fallback`.

## Corpus sync command
Refresh the machine-readable corpus manifest from LilyPond:

```bash
cd /Users/mo/git/musicxml
npm run corpus:lilypond:sync
```

The sync script (`/Users/mo/git/musicxml/scripts/sync-lilypond-corpus.mjs`) captures:
- categories and fixture counts
- source fixture names + URLs
- category IDs for each fixture

## Fixture import command
Import selected collated-suite cases into conformance fixtures:

```bash
cd /Users/mo/git/musicxml
npm run corpus:lilypond:import -- --cases 12a,14a,21a
```

Notes:
- Case selectors accept case IDs (`12a`) or full source names (`12a-Clefs.xml`).
- Imported fixtures are written under `/Users/mo/git/musicxml/fixtures/conformance/lilypond/`.

## Bulk promotion command
Promote all remaining collated-suite fixtures not yet imported:

```bash
cd /Users/mo/git/musicxml
npm run conformance:lilypond:promote
```

Behavior:
- Downloads each missing fixture and writes it to `/Users/mo/git/musicxml/fixtures/conformance/lilypond/`.
- Auto-classifies `expected: pass|fail` using current lenient parse + render observation.
- Marks imported fixtures as `status: active`.
- For expected-fail results, emits `linked_todo: R-002` and stores observed failure reasons in `notes`.

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
2. Register/update seed entries in `/Users/mo/git/musicxml/demos/lilypond/manifest.json`.
3. Promote related conformance fixtures under `/Users/mo/git/musicxml/fixtures/conformance/`.
4. Update category status notes in `/Users/mo/git/musicxml/demos/lilypond/manifest.json`.
5. Rebuild demos and inspect:
   - `npm run demos:build`
   - `http://localhost:4173/lilypond-roadmap.html`
6. Keep planning state in sync:
   - `/Users/mo/git/musicxml/docs/planning/status.md`
   - `/Users/mo/git/musicxml/docs/planning/logs.md`
   - `/Users/mo/git/musicxml/docs/planning/todo.md`

## Why this matters
- Demo credibility: users can compare behavior against known suite fixtures instead of hand-crafted samples.
- Triage speed: each demo links back to an official source fixture.
- End-goal alignment: demo roadmap categories mirror the same LilyPond suite that drives M7 conformance.
