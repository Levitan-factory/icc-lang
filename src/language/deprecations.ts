export type IccDeprecationStatus = "legacy" | "deprecated";

export interface IccDeprecation {
  syntax: string;
  status: IccDeprecationStatus;
  replacement: string;
  deprecatedIn: string;
  removalTarget: string;
  autoFix: boolean;
  notes: string;
}

export const ICC_DEPRECATIONS: IccDeprecation[] = [
  {
    syntax: "{{...}}",
    status: "legacy",
    replacement: "%from cN / %from cN.field / %file.cN:name.ext",
    deprecatedIn: "v1.01",
    removalTarget: "v2.0",
    autoFix: true,
    notes: "Double-brace references are accepted only for migration from older notebook drafts.",
  },
  {
    syntax: "%output.cN",
    status: "legacy",
    replacement: "%from cN",
    deprecatedIn: "v1.02",
    removalTarget: "v2.0",
    autoFix: true,
    notes: "Current dataflow uses one explicit prior-output reference form.",
  },
  {
    syntax: "%var.cN.name",
    status: "legacy",
    replacement: "%from cN.name",
    deprecatedIn: "v1.02",
    removalTarget: "v2.0",
    autoFix: true,
    notes: "Structured field reads now use %from with a dotted field path.",
  },
  {
    syntax: "@forward! cN",
    status: "legacy",
    replacement: "@forward cN",
    deprecatedIn: "v1.02",
    removalTarget: "v2.0",
    autoFix: true,
    notes: "Forwarding now autoruns the direct target after successful completion.",
  },
  {
    syntax: ".synthesis",
    status: "deprecated",
    replacement: ".ensemble",
    deprecatedIn: "v1.04",
    removalTarget: "v2.0",
    autoFix: true,
    notes: "ICC keeps one term for combined multi-model answers: ensemble.",
  },
  {
    syntax: "@use artifact",
    status: "deprecated",
    replacement: "%file.cN:name.ext",
    deprecatedIn: "v1.04",
    removalTarget: "v2.0",
    autoFix: false,
    notes: "Artifact reads belong in prompt text as references rather than header commands.",
  },
];
