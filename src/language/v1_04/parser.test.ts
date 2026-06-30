import { describe, expect, it } from "vitest";
import { hasLegacyIccSyntax, migrateLegacyIccSyntax, parseCellDsl } from "./parser";

const options = {
  knownAliases: ["c1", "c2", "c3"],
  defaultLoopIterations: 3,
  maxLoopIterations: 10,
};

describe("parseCellDsl", () => {
  it("parses best routing with constraints and forward autorun", () => {
    const parsed = parseCellDsl(
      "> (openai + claude).best\n< cost <= $3.33\n< latency <= 3m\n@forward c2",
      "Compare the options.",
      options,
    );

    expect(parsed.routing?.mode).toBe("best");
    expect(parsed.routing?.providers.map((provider) => provider.provider)).toEqual(["openai", "claude"]);
    expect(parsed.constraints.costMaxUsd).toBe(3.33);
    expect(parsed.constraints.latencyMaxSec).toBe(180);
    expect(parsed.flow).toEqual({ type: "forward", target: "c2", targets: ["c2"], autorun: true });
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("rejects multiple routing lines in one cell", () => {
    const parsed = parseCellDsl(
      "> (openai + claude).best\n> openrouter:openai/gpt-image-1\n@forward c2",
      "Generate a brief and then an image.",
      {
        ...options,
        providerAliases: [
          { id: "provider_openrouter", alias: "openrouter", label: "OpenRouter", models: ["openai/gpt-image-1"] },
        ],
      },
    );

    expect(parsed.routing?.raw).toBe("(openai + claude).best");
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.level === "error" && diagnostic.message.includes("Only one routing line"))).toBe(true);
  });

  it("ignores escaped service lines without affecting following header lines", () => {
    for (const escapedLine of ["\\> claude", "\\< cost <= $1", "\\@text <1000"]) {
      const parsed = parseCellDsl(
        ["> openai.max", escapedLine, "< tokens <= 50000", "@forward c2"].join("\n"),
        "Compare the options.",
        options,
      );

      expect(parsed.routing?.providers[0]).toMatchObject({ provider: "openai", profile: "max" });
      expect(parsed.flow).toEqual({ type: "forward", target: "c2", targets: ["c2"], autorun: true });
      expect(parsed.outputs.text).toBeUndefined();
      expect(parsed.constraints.tokensMax).toBe(50000);
      expect(parsed.constraints.costMaxUsd).toBeUndefined();
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
    }
  });

  it("parses provider max, group best, and ensemble routing", () => {
    const max = parseCellDsl("> chinese.max", "Choose the strongest answer.", {
      ...options,
      providerAliases: [{ id: "provider_deepseek", alias: "chinese", label: "DeepSeek" }],
    });
    const best = parseCellDsl("> (claude + chinese).best", "Choose the strongest answer.", {
      ...options,
      providerAliases: [{ id: "provider_deepseek", alias: "chinese", label: "DeepSeek" }],
    });
    const ensemble = parseCellDsl("> (openrouter + claude).ensemble", "Synthesize the answers.", {
      ...options,
      providerAliases: [{ id: "provider_openrouter", alias: "openrouter", label: "OpenRouter" }],
    });

    expect(max.routing?.mode).toBe("single");
    expect(max.routing?.providers[0]?.profile).toBe("max");
    expect(best.routing?.mode).toBe("best");
    expect(best.routing?.method).toBe("best");
    expect(best.chips).toContain("best");
    expect(ensemble.routing?.mode).toBe("synthesis");
    expect(ensemble.routing?.method).toBe("ensemble");
    expect(ensemble.chips).toContain("ensemble");
    expect([...max.diagnostics, ...best.diagnostics, ...ensemble.diagnostics].filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("rejects single-provider .ensemble routes", () => {
    const parsed = parseCellDsl("> openai.ensemble", "Combine the answers.", options);

    expect(parsed.routing).toBeUndefined();
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("only valid after a provider group"))).toBe(true);
  });

  it("rejects legacy group .max and .synthesis routes", () => {
    const groupedMax = parseCellDsl("> (openai + claude).max", "Choose the strongest answer.", options);
    const synthesis = parseCellDsl("> (openai + claude).synthesis", "Combine the answers.", options);

    expect(groupedMax.diagnostics.some((diagnostic) => diagnostic.message.includes("Group routing uses `.best`"))).toBe(true);
    expect(synthesis.diagnostics.some((diagnostic) => diagnostic.message.includes("Use `.ensemble`"))).toBe(true);
  });

  it("parses OpenRouter model ids with slashes and suffixes", () => {
    const parsed = parseCellDsl("> router:deepseek/deepseek-chat:free", "Use OpenRouter.", {
      ...options,
      providerAliases: [{ id: "provider_openrouter", alias: "router", label: "OpenRouter" }],
    });

    expect(parsed.routing?.providers[0]).toMatchObject({
      provider: "provider_openrouter",
      alias: "router",
      model: "deepseek/deepseek-chat:free",
    });
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("keeps OpenRouter model syntax unambiguous", () => {
    const explicitModel = parseCellDsl("> openrouter:openai/gpt-4o", "Use OpenRouter.", {
      ...options,
      providerAliases: [{ id: "provider_openrouter", alias: "openrouter", label: "OpenRouter", models: ["openai/gpt-4o"] }],
    });
    const dottedModel = parseCellDsl("> openrouter.openai.max", "Use OpenRouter.", {
      ...options,
      providerAliases: [{ id: "provider_openrouter", alias: "openrouter", label: "OpenRouter" }],
    });

    expect(explicitModel.routing?.providers[0]).toMatchObject({
      provider: "provider_openrouter",
      alias: "openrouter",
      model: "openai/gpt-4o",
    });
    expect(explicitModel.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
    expect(dottedModel.diagnostics.some((diagnostic) => diagnostic.message.includes("Invalid provider expression"))).toBe(true);
  });

  it("rejects unknown explicit provider models when the workspace exposes a model list", () => {
    const parsed = parseCellDsl("> openrouter:open", "Use OpenRouter.", {
      ...options,
      providerAliases: [
        {
          id: "provider_openrouter",
          alias: "openrouter",
          label: "OpenRouter",
          models: ["openrouter/auto", "openai/gpt-5.5", "anthropic/claude-sonnet-4.5"],
        },
      ],
    });

    expect(parsed.diagnostics.some((diagnostic) => diagnostic.level === "error" && diagnostic.message.includes("Unknown model"))).toBe(true);
    expect(parsed.chips).toContain("header error");
  });

  it("parses native ICC percent references and dependencies", () => {
    const parsed = parseCellDsl(
      "> claude.max",
      "Input: %from c1\nUse %from c2.pnl, %file.c3:strategy.py, %meta.c2.cost, %error.c2.message, and 0.045% as text.",
      options,
    );

    expect(parsed.references.map((reference) => reference.raw)).toEqual([
      "%from c1",
      "%from c2.pnl",
      "%file.c3:strategy.py",
      "%meta.c2.cost",
      "%error.c2.message",
    ]);
    expect(parsed.dependencies).toEqual(["c1", "c2", "c3"]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("detects and migrates legacy ICC syntax", () => {
    const source = "@forward! c2\nInput:\n{{c2.output}}\n{{c2.vars.pnl}}\n{{c3.artifact.strategy_code.py}}\n@input\n%output.c1.reason\n%var.c2.pnl";

    expect(hasLegacyIccSyntax(source)).toBe(true);
    expect(migrateLegacyIccSyntax(source, { inputSourceAlias: "c1" })).toBe(
      "@forward c2\nInput:\n%from c2\n%from c2.pnl\n%file.c3:strategy_code.py\n%from c1\n%from c1.reason\n%from c2.pnl",
    );
  });

  it("parses grouped parallel routing without a selector suffix", () => {
    const parsed = parseCellDsl("> (openai + claude)", "Compare.", options);

    expect(parsed.routing?.mode).toBe("parallel");
    expect(parsed.routing?.providers.map((provider) => provider.provider)).toEqual(["openai", "claude"]);
  });

  it("resolves workspace provider aliases case-insensitively", () => {
    const parsed = parseCellDsl("> ResearchGPT.max", "Use the configured alias.", {
      ...options,
      providerAliases: [{ id: "openai", alias: "ResearchGPT", label: "OpenAI" }],
    });

    expect(parsed.routing?.providers[0]).toMatchObject({
      provider: "openai",
      alias: "ResearchGPT",
      label: "OpenAI",
      profile: "max",
    });
    expect(parsed.chips).toContain("ResearchGPT.max");
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("does not expose internal provider ids in alias diagnostics", () => {
    const parsed = parseCellDsl("> missing", "Use the configured alias.", {
      ...options,
      providerAliases: [{ id: "provider_123", provider: "openrouter", alias: "chinese", label: "DeepSeek" }],
    });

    const message = parsed.diagnostics.find((diagnostic) => diagnostic.level === "error")?.message ?? "";
    expect(message).toContain("openrouter");
    expect(message).toContain("chinese");
    expect(message).not.toContain("provider_123");
  });

  it("detects a loop chain and applies the workspace default iteration cap", () => {
    const parsed = parseCellDsl("> openai\n@chain c1 > c2 > c1", "Loop until stable.", options);

    expect(parsed.flow).toEqual({
      type: "chain",
      nodes: ["c1", "c2", "c1"],
      loop: true,
      iterations: 3,
    });
    expect(parsed.chips).toContain("loop x3");
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.level === "warning")).toBe(true);
  });

  it("reports broken references as run-blocking errors", () => {
    const parsed = parseCellDsl("> claude", "Use %from c9", options);

    expect(parsed.references).toHaveLength(1);
    expect(parsed.diagnostics).toContainEqual({
      level: "error",
      message: "Reference error: cell `c9` not found.",
    });
    expect(parsed.chips).toContain("header error");
  });

  it("keeps @if flow when an @else target is present", () => {
    const parsed = parseCellDsl("> openai.max\n@if pnl > 0 -> c2\n@else -> c3", "Evaluate result.", options);

    expect(parsed.flow).toMatchObject({
      type: "if",
      condition: "pnl > 0",
      target: "c2",
      elseTarget: "c3",
    });
    expect(parsed.chips).toContain("if");
  });

  it("parses @file and @text directives", () => {
    const parsed = parseCellDsl(
      "> claude.max\n@file -python strategy\n@file .md\n@text <300",
      "Write the implementation.",
      {
        ...options,
        cells: [
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
                sizeBytes: 12,
                content: "report",
                status: "created",
                createdAt: "2026-06-17T00:00:00.000Z",
                metadata: { autoNamed: false, source: "llm_output" },
              },
            ],
          },
        ],
      },
    );

    expect(parsed.outputs.files).toHaveLength(2);
    expect(parsed.outputs.files[0]).toMatchObject({
      channel: "file",
      formatId: "python",
      name: "strategy.py",
      extension: ".py",
    });
    expect(parsed.outputs.files[1]).toMatchObject({
      channel: "file",
      formatId: "markdown",
      autoName: true,
      extension: ".md",
    });
    expect(parsed.outputs.text?.limitChars).toBe(300);
    expect(parsed.outputs.uses).toEqual([]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("normalizes output formats and image directives", () => {
    const parsed = parseCellDsl(
      "@file\n@file -json config\n@file -typescript parser.ts\n@image -webp mascot",
      "Create outputs.",
      options,
    );

    expect(parsed.outputs.files).toMatchObject([
      { channel: "file", formatId: "auto", autoSelect: true, autoName: true },
      { channel: "file", formatId: "json", name: "config.json", extension: ".json" },
      { channel: "file", formatId: "typescript", name: "parser.ts", extension: ".ts" },
    ]);
    expect(parsed.outputs.images).toMatchObject([
      { channel: "image", formatId: "webp", name: "mascot.webp", extension: ".webp" },
    ]);
    expect(parsed.chips).toEqual(expect.arrayContaining(["file: auto", "file: json", "file: typescript", "image: webp"]));
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("expands artifact filename ranges for files and images", () => {
    const parsed = parseCellDsl(
      "@file -markdown output_{01..03}.md\n@image -png frame_{1..2}.png",
      "Create outputs.",
      options,
    );

    expect(parsed.outputs.files.map((file) => file.name)).toEqual(["output_01.md", "output_02.md", "output_03.md"]);
    expect(parsed.outputs.files.map((file) => file.formatId)).toEqual(["markdown", "markdown", "markdown"]);
    expect(parsed.outputs.images.map((image) => image.name)).toEqual(["frame_1.png", "frame_2.png"]);
    expect(parsed.outputs.images.map((image) => image.formatId)).toEqual(["png", "png"]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("rejects artifact ranges that expand too far or use multiple ranges", () => {
    const parsed = parseCellDsl(
      "@file -markdown output_{1..51}.md\n@image -png frame_{1..2}_{1..2}.png",
      "Create outputs.",
      options,
    );

    expect(parsed.outputs.files).toHaveLength(0);
    expect(parsed.outputs.images).toHaveLength(0);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code).filter(Boolean)).toEqual([
      "artifact_range_too_large",
      "artifact_range_multiple",
    ]);
  });

  it("rejects mismatched, binary, unknown, and wrong-channel outputs", () => {
    const parsed = parseCellDsl(
      "@file -python report.md\n@file archive.zip\n@file output.abc\n@file logo.png\n@image icon.svg",
      "",
      options,
    );

    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code).filter(Boolean)).toEqual([
      "format_extension_mismatch",
      "binary_format_not_directly_generatable",
      "unknown_extension",
      "image_format_requires_image_channel",
      "capability_mismatch",
    ]);
    expect(parsed.chips).toContain("header error");
  });

  it("warns and migrates legacy explicit file format syntax", () => {
    const parsed = parseCellDsl("@file markdown spec.md", "", options);

    expect(parsed.outputs.files[0]).toMatchObject({
      formatId: "markdown",
      name: "spec.md",
      extension: ".md",
    });
    expect(parsed.diagnostics).toContainEqual({
      level: "warning",
      line: 1,
      code: "legacy_file_format_syntax",
      message: "legacy_file_format_syntax: use @file -markdown spec.md instead.",
    });
  });

  it("rejects invalid @file and @text forms", () => {
    const parsed = parseCellDsl("@file report\n@text 100", "", options);

    expect(parsed.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "File has no extension. ICC will save it as Markdown; use @file -<format> name for another type.",
      "Invalid @text directive. Use `@text` or `@text <100`.",
    ]);
  });
});
