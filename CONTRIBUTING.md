# Contributing to ICC DSL

ICC DSL changes are versioned. Public contributions should state whether they target the stable channel, a preview channel, or an experimental branch.

Before proposing a syntax change:

1. Describe the user-facing syntax.
2. Add parser tests for accepted and rejected forms.
3. Add catalog/reference metadata.
4. State migration behavior for older documents.
5. Run `npm test` and `npm run build`.

Breaking changes must not enter the stable channel without a new language release.
