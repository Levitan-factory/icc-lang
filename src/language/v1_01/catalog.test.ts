import { describe, expect, it } from "vitest";
import {
  CONDITION_OPERATORS,
  KNOWN_PROVIDERS,
  PROVIDER_PROFILES,
  SUPPORTED_FILE_EXTENSIONS,
  SUPPORTED_REFERENCE_FIELDS,
  parseCellDsl,
} from "./parser";
import { dslCatalogEntries } from "./catalog";

const requiredSupportedEntryIds = [
  "routing-line",
  "single-provider",
  "explicit-model",
  "model-profile",
  "parallel-routing",
  "best-routing",
  "synthesis-routing",
  "auto-routing",
  "cost-constraint",
  "latency-constraint",
  "tokens-constraint",
  "iterations-constraint",
  "input-placeholder",
  "forward",
  "forward-autorun",
  "chain",
  "chain-loop",
  "if-branch",
  "else-branch",
  "file-output-auto",
  "file-output-extension",
  "file-output-named",
  "text-output",
  "text-output-limit",
  "use-artifact",
  "reference-field",
  "reference-var",
  "reference-artifact",
  "legacy-reference-migration",
  "header-boundary",
  "escape-service-line",
  "cell-alias",
  "known-providers",
  "routing-modes",
  "status-values",
];

describe("dslCatalog", () => {
  it("documents every supported parser feature family", () => {
    const supportedIds = new Set(
      dslCatalogEntries.filter((entry) => entry.status === "supported").map((entry) => entry.id),
    );

    requiredSupportedEntryIds.forEach((entryId) => {
      expect(supportedIds.has(entryId), `Missing supported catalog entry ${entryId}`).toBe(true);
    });
  });

  it("stays aligned with parser constants", () => {
    const knownProviders = dslCatalogEntries.find((entry) => entry.id === "known-providers");
    const modelProfile = dslCatalogEntries.find((entry) => entry.id === "model-profile");
    const conditionBranch = dslCatalogEntries.find((entry) => entry.id === "if-branch");
    const referenceField = dslCatalogEntries.find((entry) => entry.id === "reference-field");
    const fileExtension = dslCatalogEntries.find((entry) => entry.id === "file-output-extension");

    expect(knownProviders?.syntax).toEqual(KNOWN_PROVIDERS);
    PROVIDER_PROFILES.forEach((profile) => expect(modelProfile?.notes.join(" ")).toContain(profile));
    CONDITION_OPERATORS.forEach((operator) => expect(conditionBranch?.notes.join(" ")).toContain(operator));
    expect(referenceField?.notes.join(" ")).toContain(SUPPORTED_REFERENCE_FIELDS.join(", "));
    SUPPORTED_FILE_EXTENSIONS.forEach((extension) => expect(fileExtension?.notes.join(" ")).toContain(extension));
  });

  it("keeps catalog examples compatible with the current parser", () => {
    const parsed = parseCellDsl(
      [
        "> (openai + claude).best",
        "< cost <= $3.33",
        "< latency <= 3m",
        "< tokens <= 50000",
        "< iterations <= 3",
        "@file strategy_code.py",
        "@file .md",
        "@text <300",
        "@use artifact c2/report.md",
        "@forward! c3",
      ].join("\n"),
      "Use %output.c1 and %file.c2:report.md.",
      {
        knownAliases: ["c1", "c2", "c3"],
        defaultLoopIterations: 3,
        maxLoopIterations: 10,
        cells: [
          { alias: "c1", vars: {}, artifacts: [] },
          {
            alias: "c2",
            vars: {},
            artifacts: [
              {
                id: "art_1",
                cellId: "cell_2",
                cellAlias: "c2",
                runId: "run_1",
                displayName: "report.md",
                extension: ".md",
                mimeType: "text/markdown",
                version: 1,
                storageKey: "cells/c2/report.md",
                sizeBytes: 6,
                content: "report",
                status: "created",
                createdAt: "2026-06-17T00:00:00.000Z",
                metadata: { autoNamed: false, source: "llm_output" },
              },
            ],
          },
          { alias: "c3", vars: {}, artifacts: [] },
        ],
      },
    );

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });
});
