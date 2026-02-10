# Parser Architecture (M1-M6 Baseline)

Pipeline:
1. `parseXmlToAst` (`saxes` tokenizer + AST builder).
2. Root dispatch (`score-partwise` accepted; `score-timewise` normalized to partwise in M3).
3. AST to CSM transform:
   - parse `<part-list>`
   - parse parts/measures/attributes
   - consume `<backup>`/`<forward>` into timeline offsets
   - normalize `<chord/>` notes into `NoteEvent.notes[]`
4. Validation and recovery:
   - strict mode escalates validation failures to errors and suppresses `score`.
   - lenient mode applies defaults and truncation heuristics.
5. Async container path:
   - `.mxl` ZIP archives decode through central-directory parsing.
   - `META-INF/container.xml` rootfile resolution selects score payload.
   - Missing/invalid container metadata emits diagnostics and uses fallback score lookup.

Current scope:
- Supports partwise parsing for attributes, notes, rests, directions, and barlines.
- Supports advanced note/barline metadata including grace/cue/ornament/tuplet and repeat/ending semantics.
- Supports score-timewise input through normalization to partwise before CSM transform.
- Leaves deeper post-M6 domains (dense multi-voice tuplets, full repeat playback graph, etc.) for later milestones.
