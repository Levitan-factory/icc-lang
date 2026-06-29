import { describe, expect, it } from "vitest";
import { parseCellDsl } from "./parser";

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
    expect(parsed.flow).toEqual({ type: "forward", target: "c2", autorun: true });
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
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
    const parsed = parseCellDsl("> claude", "Use {{c9.output}}", options);

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
      "Missing file extension. Use `@file`, `@file .md`, or `@file report.md`.",
      "Invalid @text directive. Use `@text` or `@text <100`.",
    ]);
  });
});
