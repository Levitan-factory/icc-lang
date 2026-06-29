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
      "> (openai + claude).best\n< cost <= $3.33\n< latency <= 3m\n@forward! c2",
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

  it("parses max and ensemble routing aliases", () => {
    const max = parseCellDsl("> (claude + chinese).max", "Choose the strongest answer.", {
      ...options,
      providerAliases: [{ id: "provider_deepseek", alias: "chinese", label: "DeepSeek" }],
    });
    const ensemble = parseCellDsl("> (openrouter + claude).ensemble", "Synthesize the answers.", {
      ...options,
      providerAliases: [{ id: "provider_openrouter", alias: "openrouter", label: "OpenRouter" }],
    });

    expect(max.routing?.mode).toBe("best");
    expect(max.routing?.method).toBe("max");
    expect(max.chips).toContain("max");
    expect(ensemble.routing?.mode).toBe("synthesis");
    expect(ensemble.routing?.method).toBe("ensemble");
    expect(ensemble.chips).toContain("ensemble");
    expect([...max.diagnostics, ...ensemble.diagnostics].filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
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
      "Input: %input\nUse %output.c1, %var.c2.pnl, %file.c3:strategy.py, %meta.c2.cost, and %error.c2.",
      options,
    );

    expect(parsed.references.map((reference) => reference.raw)).toEqual([
      "%input",
      "%output.c1",
      "%var.c2.pnl",
      "%file.c3:strategy.py",
      "%meta.c2.cost",
      "%error.c2",
    ]);
    expect(parsed.dependencies).toEqual(["c1", "c2", "c3"]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("detects and migrates legacy ICC syntax", () => {
    const source = "Input:\n{{c2.output}}\n{{c3.artifact.strategy_code.py}}\n@input";

    expect(hasLegacyIccSyntax(source)).toBe(true);
    expect(migrateLegacyIccSyntax(source)).toBe("Input:\n%output.c2\n%file.c3:strategy_code.py\n%input");
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
    const parsed = parseCellDsl("> claude", "Use %output.c9", options);

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

  it("parses @file, @text and artifact use directives", () => {
    const parsed = parseCellDsl(
      "> claude.max\n@file strategy.py\n@file .md\n@text <300\n@use artifact c2/report.md",
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
    expect(parsed.outputs.text?.limitChars).toBe(300);
    expect(parsed.outputs.uses).toEqual([
      { alias: "c2", filename: "report.md", raw: "@use artifact c2/report.md", line: 5 },
    ]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });

  it("rejects invalid @file and @text forms", () => {
    const parsed = parseCellDsl("@file report\n@text 100", "", options);

    expect(parsed.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "File has no extension. ICC will infer type or fallback to .md.",
      "Invalid @text directive. Use `@text` or `@text <100`.",
    ]);
  });
});
