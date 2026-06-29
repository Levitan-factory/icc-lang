# ICC DSL Release Protocol

This is the single release gate for ICC DSL changes. It exists so the language, notebook, public site, and generated reference never drift apart.

## Channels

| Channel | Branch prefix | Purpose | Public status |
| --- | --- | --- | --- |
| `stable` | `lang/stable/...` | Public syntax supported by ICC-GO and the public reference site. | Default public channel |
| `preview` | `lang/preview/...` | Candidate syntax that is being reviewed before promotion. | Not normative |
| `experimental` | `lang/experimental/...` | Research syntax and implementation experiments. | Not normative |

The current public channel is declared in `icc-go/src/language/channels.ts`. The public language site and ICC-GO derive their displayed language version from that file.

## Required Question Before Work

Before any `[LANG]` task changes syntax, parser behavior, catalog entries, examples, reference pages, or language release records, the maintainer or assistant must identify the channel:

```text
Language channel: stable / preview / experimental
Branch: lang/<channel>/<short-change-name>
```

If the task does not state the channel, ask for it before editing language files. Editorial changes to non-language pages may proceed under `[LANG-SITE]` without a language channel.

## Release Checklist

1. Create or select the concrete implementation folder under `icc-go/src/language/vX_Y`.
2. Update parser behavior, catalog entries, format registry entries, tests, and examples in that folder.
3. Update `icc-go/src/language/channels.ts` only when a channel target changes.
4. Update `icc-go/src/language/latest/index.ts` only when the public stable target changes.
5. Add or update the release record in `src/content/releases/` with `channel`, `status`, `stability`, and the required changelog sections.
6. Update the public language site surfaces for the channel:
   - stable releases update the generated reference and current syntax;
   - preview releases must appear on the home page, versions page, and reference-page preview notice without being mixed into current stable syntax;
   - experimental releases must remain visibly non-normative.
7. Update examples, screenshots, and notebook/site specimens whenever they show changed syntax. If a visual asset is not regenerated in the same change, record why in the release notes or PR.
8. Update deprecations in `icc-go/src/language/deprecations.ts`.
9. Ensure ICC-GO notebook metadata still records `dsl_version`, `dsl_channel`, `runtime`, and `created_with`.
10. Run:

```bash
./scripts/release-preflight.sh --channel <stable|preview|experimental>
```

Use `--allow-main` on the guard only for repository-maintenance commits that intentionally modify the guard or release protocol itself.

## Deprecation Policy

Every deprecated or legacy form must have:

- syntax;
- replacement;
- `deprecatedIn`;
- `removalTarget`;
- whether an automatic fix exists;
- a short note for documentation and migration tools.

The canonical registry is `icc-go/src/language/deprecations.ts`. Public reference pages may summarize it, but should not invent a separate deprecation list.

## Notebook Metadata Contract

Every ICC-GO notebook created or imported by the app stores:

```json
{
  "dsl_version": "1.04.0",
  "dsl_version_label": "ICC DSL v1.04",
  "dsl_channel": "stable",
  "runtime": "icc-go",
  "created_with": "v0.1.10",
  "created_at": "2026-06-24T00:00:00.000Z"
}
```

If an older notebook is imported, ICC-GO migrates it to the supported language and records the prior DSL version in `migrated_from` when that information is available.
