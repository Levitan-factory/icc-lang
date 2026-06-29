import { describe, expect, it } from "vitest";
import {
  LANGUAGE_VERSION,
  LATEST_LANGUAGE_VERSION,
  LATEST_LANGUAGE_VERSION_LABEL,
  PUBLIC_LANGUAGE_CHANNEL,
  parseCellDsl,
} from ".";

describe("latest language adapter", () => {
  it("points notebook consumers at the current language implementation", () => {
    expect(LATEST_LANGUAGE_VERSION).toBe(LANGUAGE_VERSION);
    expect(LATEST_LANGUAGE_VERSION_LABEL).toBe("v1.04");
    expect(PUBLIC_LANGUAGE_CHANNEL.channel).toBe("stable");
    expect(PUBLIC_LANGUAGE_CHANNEL.version).toBe(LATEST_LANGUAGE_VERSION);

    const parsed = parseCellDsl("> openai\n@text <100", "Hello %from c1", {
      knownAliases: ["c1"],
      defaultLoopIterations: 3,
      maxLoopIterations: 10,
    });

    expect(parsed.outputs.text?.limitChars).toBe(100);
    expect(parsed.references[0]?.raw).toBe("%from c1");
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
  });
});
