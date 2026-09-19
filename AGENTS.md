# B2E Skills

Canonical content lives in `skills/<slug>/SKILL.md` and its own references. `catalog.json` defines five categories and the stable legacy MD names. Generated `dist/` is never committed. Frozen compatibility archives are release inputs, not editable sources.

- Work in a focused branch. Commit each skill separately; infrastructure and documentation separately.
- Keep instructions scoped, self-contained and grounded in reviewed content. Do not add a mandatory questionnaire or inter-skill dependency.
- Never include private sources, provenance identifiers, correspondence, credentials, evaluation transcripts or local filesystem paths in this repository or history.
- Do not assign a standard license or claim exclusive authorship of all methods.
- Run `npm test`, `npm run build`, `git diff --check`; validate changed SKILL frontmatter.
- Behaviour checks are separate from syntax checks. Record only observed results; do not infer improvement from packaging.
- A second human reviews content, public safety and usefulness before publication/merge. CI passing is not approval. No release or site deployment from a PR.
- Update the website only from a pinned, reviewed release. Never touch the materials service, database or other projects.
