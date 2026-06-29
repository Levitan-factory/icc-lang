# ICC DSL

ICC DSL is the Intent-Cell Coding language library: parser, syntax catalog, release channels, deprecations, and migration helpers.

This repository is generated from the private ICC project monorepo. It contains language code only; the public language site, hosted notebook infrastructure, and deployment scripts are intentionally excluded.

Public language reference: https://icc-dsl.org/

Reference notebook implementation: https://github.com/Levitan-factory/icc-go

## Commands

```bash
npm install
npm test
npm run build
```

## Public API

```ts
import { parseCellDsl, dslCatalogEntries, PUBLIC_LANGUAGE_CHANNEL } from "icc-dsl";
```
