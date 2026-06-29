# ICC Version Policy

ICC uses separate version lines for the language, the notebook, the public sites, and deployment infrastructure. These versions must not be collapsed into one number.

## Versioned Artifacts

### ICC DSL Language

The language version describes syntax and semantics: operators, functions, references, directives, parser behavior, and compatibility.

Authoritative files:

- `icc-go/src/language/latest/`
- `icc-go/src/language/channels.ts`
- `icc-go/src/language/deprecations.ts`
- `icc-go/src/language/v*/`
- `src/content/releases/`
- `src/data/iccReference.ts` as the public-site adapter to `icc-go/src/language/latest`

Policy:

- Use semantic versioning internally: `MAJOR.MINOR.PATCH`.
- Public labels may use the compact academic form, for example `v1.01`.
- Additive syntax, new operators, new references, or new functions require a minor release.
- Corrections that do not change interpretation require a patch release or errata.
- Breaking syntax or changed interpretation requires a major release.
- Every syntax-changing task must declare one language channel: `stable`, `preview`, or `experimental`.
- Deprecated and legacy forms must be recorded in `icc-go/src/language/deprecations.ts`.

Language channels:

- `stable`: public syntax supported by ICC-GO and the public reference site.
- `preview`: candidate syntax under review before stable promotion.
- `experimental`: research syntax that is not normative.

### ICC-GO Notebook

The notebook version describes the application: UI, local bundle, runtime integration, settings, examples, and embedded docs.

Authoritative files:

- `icc-go/package.json`
- `icc-go/src/`
- `icc-go/docs/`

Policy:

- The notebook must declare which ICC DSL language version it supports.
- A notebook release may change without a language release.
- A language release may require a notebook release when parser behavior or docs change.

### ICC DSL Site

The ICC DSL site version is a site implementation/deployment concern, not the language version.

Authoritative files:

- root `package.json`
- `src/`
- `docs/deployment/aws.md`

Policy:

- Editorial or design-only changes do not create a new ICC DSL language version.
- Reference content changes that describe syntax must point to a language release.

### ICC-GO Site

The ICC-GO public product site version is independent from the notebook version unless it publishes a new bundle or documents a new notebook capability.

Authoritative files:

- `icc-go-site/`
- `scripts/package-icc-go-bundle.sh`
- `docs/deployment/icc-go-aws.md`

Policy:

- Site polish does not bump the notebook version.
- A newly published bundle should identify the ICC-GO notebook version and supported ICC DSL language version.

## Compatibility Matrix

Every ICC-GO release should be able to answer:

- Which ICC DSL version does it parse?
- Which documentation version is embedded?
- Which examples were validated against that parser?
- Which bundle was published to `icc-go.com`?

Recommended release note format:

```text
ICC-GO v0.1.10
Supports: ICC DSL v1.03
Bundle: icc-go-local-0.1.10.zip
Docs: generated from ICC DSL v1.03 catalog
```

## Required Checks

For ICC-LANG changes:

```bash
npm run guard:language -- --channel stable
npm run check:versions
npm run test:icc-go
npm run build
```

For ICC-GO-APP changes:

```bash
npm run build:icc-go
npm run test:icc-go
```

For ICC-GO-SITE changes:

```bash
npm run build:icc-go-site
```

For bundle publishing:

```bash
npm run package:icc-go
npm run build:icc-go-site
```

For ICC-SITE changes:

```bash
npm run check:versions
npm run build
```

## Language Release Process

1. Ask and record the target channel: `stable`, `preview`, or `experimental`.
2. Work on `lang/<channel>/<short-change-name>` unless this is a repository-maintenance commit.
3. Create or update the concrete language folder under `icc-go/src/language/vX_Y`.
4. Keep parser behavior, catalog entries, format registry changes, and tests in the same language version folder.
5. Update `icc-go/src/language/channels.ts` only when a channel target changes.
6. Update `icc-go/src/language/latest/index.ts` only when the public stable language version changes.
7. Add a release record under `src/content/releases/` with channel, status, summary, added, changed, deprecated, removed, migration, compatibility notes, canonical examples, and errata.
8. Expose the channel on the public language site:
   - stable is the only source for current syntax and generated reference content;
   - preview must be visible on the home page, versions page, and reference-page preview notice;
   - experimental must be visibly separated from normative syntax.
9. Update examples, screenshots, and public specimens whenever they show changed syntax. Missing visual refreshes must be explicitly documented.
10. Ensure the ICC-GO notebook and ICC-GO site read their supported ICC DSL version from `icc-go/src/version.ts`.
11. Run `./scripts/release-preflight.sh --channel <channel>` before pushing or deploying.
12. Commit language core, release record, generated public reference behavior, compatible notebook docs, and process updates together.

The detailed operational checklist lives in `LANGUAGE_RELEASE_PROTOCOL.md`.
