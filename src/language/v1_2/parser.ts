import type {
  Artifact,
  ArtifactUseDirective,
  CellReference,
  ConstraintPlan,
  Diagnostic,
  FileOutputDirective,
  FlowPlan,
  NotebookCell,
  ParsedDsl,
  ProviderId,
  ProviderSelection,
  RoutingPlan,
  TextOutputDirective,
} from "../../domain/types";

export const KNOWN_PROVIDERS: ProviderId[] = [
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "xai",
  "mistral",
  "deepseek",
  "openrouter",
  "local",
];

export const PROVIDER_PROFILES = ["default", "max", "ensemble", "cheap", "fast", "code", "reasoning"] as const;
export const ROUTING_MODES = ["single", "parallel", "best", "synthesis", "auto"] as const;
export const CONDITION_OPERATORS = [">", ">=", "<", "<=", "==", "!="] as const;
export const SUPPORTED_REFERENCE_FIELDS = ["output", "prompt", "header", "status"] as const;
export const SUPPORTED_FILE_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".html",
  ".diff",
  ".patch",
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".sql",
] as const;

const supportedReferenceFieldSet = new Set<string>(SUPPORTED_REFERENCE_FIELDS);
const supportedFileExtensionSet = new Set<string>(SUPPORTED_FILE_EXTENSIONS);
const providerLabels: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  claude: "Claude",
  gemini: "Gemini",
  xai: "xAI",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  local: "Local",
};

export interface ProviderAliasOption {
  id: ProviderId | string;
  alias: string;
  label?: string;
  provider?: ProviderId | string;
  models?: string[];
}

export interface ParseOptions {
  knownAliases: string[];
  providerAliases?: ProviderAliasOption[];
  defaultLoopIterations: number;
  maxLoopIterations: number;
  cells?: Pick<NotebookCell, "alias" | "vars" | "artifacts">[];
}

interface ProviderAliasEntry {
  id: ProviderId | string;
  alias: string;
  label?: string;
  models?: string[];
}

interface ProviderAliasLookup {
  byAlias: Map<string, ProviderAliasEntry>;
  available: string[];
}

export function parseCellDsl(
  controlHeader: string,
  promptBody: string,
  options: ParseOptions,
): ParsedDsl {
  const diagnostics: Diagnostic[] = [];
  const constraints: ConstraintPlan = {};
  const files: FileOutputDirective[] = [];
  const uses: ArtifactUseDirective[] = [];
  let text: TextOutputDirective | undefined;
  let routing: RoutingPlan | undefined;
  let flow: FlowPlan = { type: "none" };
  const providerLookup = createProviderLookup(options.providerAliases);

  const headerLines = controlHeader.split(/\r?\n/);

  for (const [index, rawLine] of headerLines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("\\>") || line.startsWith("\\<") || line.startsWith("\\@")) {
      continue;
    }

    if (line.startsWith(">")) {
      routing = parseRouting(line.slice(1).trim(), diagnostics, lineNumber, providerLookup);
      continue;
    }

    if (line.startsWith("<")) {
      parseConstraint(line.slice(1).trim(), constraints, diagnostics, lineNumber);
      continue;
    }

    if (line.startsWith("@file")) {
      const directive = parseFileDirective(line, diagnostics, lineNumber);
      if (directive) files.push(directive);
      continue;
    }

    if (line.startsWith("@text")) {
      text = parseTextDirective(line, diagnostics, lineNumber);
      continue;
    }

    if (line.startsWith("@use")) {
      const useDirective = parseUseDirective(line, diagnostics, lineNumber);
      if (useDirective) uses.push(useDirective);
      continue;
    }

    if (line.startsWith("@")) {
      if (line.startsWith("@else")) {
        parseElseLine(line, diagnostics, lineNumber);
        continue;
      }
      flow = parseFlow(line, headerLines, constraints, options, diagnostics, lineNumber);
      continue;
    }

    diagnostics.push({
      level: "warning",
      line: lineNumber,
      message: "Control header lines should start with >, <, @, or an escape.",
    });
  }

  const references = parseReferences(`${controlHeader}\n${promptBody}`, diagnostics, options);
  const dependencies = [...new Set(references.map((reference) => reference.alias).filter((alias): alias is string => Boolean(alias)))];

  if (promptBody.includes("@input") && flow.type === "none") {
    diagnostics.push({
      level: "warning",
      message: "@input is present. Run this cell through @forward or @chain, or provide input later.",
    });
  }

  if (flow.type === "chain" && flow.loop) {
    if (!constraints.iterationsMax) {
      flow = { ...flow, iterations: options.defaultLoopIterations };
      diagnostics.push({
        level: "warning",
        message: `Cycle detected. Using default iterations <= ${options.defaultLoopIterations}.`,
      });
    } else if (constraints.iterationsMax > options.maxLoopIterations) {
      diagnostics.push({
        level: "error",
        message: `Iteration limit ${constraints.iterationsMax} exceeds workspace max ${options.maxLoopIterations}.`,
      });
    } else {
      flow = { ...flow, iterations: constraints.iterationsMax };
    }
  }

  validateFlowTargets(flow, options.knownAliases, diagnostics);
  validateArtifactUses(uses, options, diagnostics);

  const outputs = { text, files, images: [], uses };

  return {
    routing,
    constraints,
    flow,
    outputs,
    references,
    dependencies,
    chips: buildChips(routing, constraints, flow, outputs, diagnostics),
    diagnostics,
  };
}

export function getSupportedFileExtensions(): string[] {
  return [...SUPPORTED_FILE_EXTENSIONS];
}

export function getSupportedReferenceFields(): string[] {
  return [...SUPPORTED_REFERENCE_FIELDS];
}

function parseRouting(
  raw: string,
  diagnostics: Diagnostic[],
  line: number,
  providerLookup: ProviderAliasLookup,
): RoutingPlan | undefined {
  if (!raw) {
    diagnostics.push({ level: "error", line, message: "Routing command is empty." });
    return undefined;
  }

  if (raw.toLowerCase() === "auto") {
    return { mode: "auto", providers: [], raw };
  }

  const grouped = raw.match(/^\((.+)\)\.(best|max|synthesis|ensemble)$/i);
  if (grouped) {
    const providers = grouped[1].split("+").map((part) => parseProvider(part.trim(), diagnostics, line, providerLookup));
    const method = grouped[2].toLowerCase() as RoutingPlan["method"];
    return {
      mode: method === "best" || method === "max" ? "best" : "synthesis",
      method,
      providers: providers.filter(Boolean) as ProviderSelection[],
      raw,
    };
  }

  if ((raw.includes("(") && !raw.includes(")")) || (!raw.includes("(") && raw.includes(")"))) {
    diagnostics.push({
      level: "error",
      line,
      message: "Syntax error: routing expression has unbalanced parentheses.",
    });
    return undefined;
  }

  if (raw.includes(",")) {
    const providers = raw.split(",").map((part) => parseProvider(part.trim(), diagnostics, line, providerLookup));
    return {
      mode: "parallel",
      providers: providers.filter(Boolean) as ProviderSelection[],
      raw,
    };
  }

  const provider = parseProvider(raw, diagnostics, line, providerLookup);
  return provider ? { mode: "single", providers: [provider], raw } : undefined;
}

function parseProvider(
  raw: string,
  diagnostics: Diagnostic[],
  line: number,
  providerLookup: ProviderAliasLookup,
): ProviderSelection | undefined {
  const providerMatch = raw.match(/^([a-zA-Z0-9_-]+)(?::([a-zA-Z0-9_./:-]+))?(?:\.(max|ensemble|cheap|fast|code|reasoning))?$/);

  if (!providerMatch) {
    diagnostics.push({ level: "error", line, message: `Invalid provider expression: ${raw}.` });
    return undefined;
  }

  const providerToken = providerMatch[1];
  const model = providerMatch[2];
  const profile = providerMatch[3] as ProviderSelection["profile"] | undefined;
  const providerEntry = providerLookup.byAlias.get(normalizeProviderKey(providerToken));

  if (!providerEntry) {
    diagnostics.push({
      level: "error",
      line,
      message: `Unknown provider alias: ${providerToken}. Available aliases: ${providerLookup.available.join(", ")}.`,
    });
  } else if (model && providerEntry.models?.length && !isKnownModel(model, providerEntry.models)) {
    diagnostics.push({
      level: "error",
      line,
      message: `Unknown model \`${model}\` for ${providerEntry.alias}. Available models: ${formatAvailableModels(providerEntry.models)}.`,
    });
  }

  return {
    provider: providerEntry?.id ?? providerToken,
    alias: providerEntry?.alias ?? providerToken,
    label: providerEntry?.label,
    model,
    profile: profile ?? (model ? undefined : "default"),
  };
}

function parseConstraint(
  raw: string,
  constraints: ConstraintPlan,
  diagnostics: Diagnostic[],
  line: number,
): void {
  const normalized = raw.replace(/\s+/g, " ").trim();

  const cost = normalized.match(/^(?:cost\s*<=\s*)?\$([0-9]+(?:\.[0-9]+)?)$/i);
  if (cost) {
    constraints.costMaxUsd = Number(cost[1]);
    return;
  }

  const latency = normalized.match(/^(?:latency\s*<=\s*)?([0-9]+)\s*(ms|s|m|h)$/i);
  if (latency) {
    const value = Number(latency[1]);
    const unit = latency[2].toLowerCase();
    constraints.latencyMaxSec =
      unit === "ms" ? value / 1000 : unit === "m" ? value * 60 : unit === "h" ? value * 3600 : value;
    return;
  }

  const tokens = normalized.match(/^tokens\s*<=\s*([0-9]+)$/i);
  if (tokens) {
    constraints.tokensMax = Number(tokens[1]);
    return;
  }

  const iterations = normalized.match(/^iterations\s*<=\s*([0-9]+)$/i);
  if (iterations) {
    constraints.iterationsMax = Number(iterations[1]);
    return;
  }

  if (/^latency\b/i.test(normalized)) {
    diagnostics.push({
      level: "error",
      line,
      message: "Expected operator after `latency`: use `< latency <= 3m`.",
    });
    return;
  }

  diagnostics.push({ level: "error", line, message: `Unknown constraint: ${raw}.` });
}

function parseFileDirective(
  line: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): FileOutputDirective | undefined {
  const match = line.match(/^@file(?:\s+(.+))?$/);
  if (!match) {
    diagnostics.push({ level: "error", line: lineNumber, message: "Invalid @file directive." });
    return undefined;
  }

  const requested = match[1]?.trim() ?? "";

  if (!requested) {
    return { requested: "", autoName: true, autoType: true, raw: line, line: lineNumber };
  }

  if (/^\.[a-zA-Z0-9]+$/.test(requested)) {
    const extension = requested.toLowerCase();
    validateFileExtension(extension, diagnostics, lineNumber);
    return { requested, extension, autoName: true, autoType: false, raw: line, line: lineNumber };
  }

  if (!requested.includes(".")) {
    diagnostics.push({
      level: "error",
      line: lineNumber,
      message: "Missing file extension. Use `@file`, `@file .md`, or `@file report.md`.",
    });
    return undefined;
  }

  if (/\s/.test(requested)) {
    diagnostics.push({
      level: "warning",
      line: lineNumber,
      message: "Artifact filenames should avoid spaces. Use snake_case or kebab-case.",
    });
  }

  const extension = requested.slice(requested.lastIndexOf(".")).toLowerCase();
  validateFileExtension(extension, diagnostics, lineNumber);

  return {
    requested,
    name: requested,
    extension,
    autoName: false,
    autoType: false,
    raw: line,
    line: lineNumber,
  };
}

function parseTextDirective(
  line: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): TextOutputDirective | undefined {
  if (line === "@text") {
    return { enabled: true, raw: line, line: lineNumber };
  }

  const preview = line.match(/^@text\s+<([0-9]+)$/);
  if (preview) {
    return { enabled: true, limitChars: Number(preview[1]), raw: line, line: lineNumber };
  }

  diagnostics.push({ level: "error", line: lineNumber, message: "Invalid @text directive. Use `@text` or `@text <100`." });
  return undefined;
}

function parseUseDirective(
  line: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): ArtifactUseDirective | undefined {
  const match = line.match(/^@use\s+artifact\s+(c[0-9]+)\/(.+)$/i);
  if (!match) {
    diagnostics.push({
      level: "error",
      line: lineNumber,
      message: "Invalid artifact use directive. Use `@use artifact c4/closeout_note.md`.",
    });
    return undefined;
  }

  return {
    alias: match[1],
    filename: match[2].trim(),
    raw: line,
    line: lineNumber,
  };
}

function parseFlow(
  line: string,
  headerLines: string[],
  constraints: ConstraintPlan,
  options: ParseOptions,
  diagnostics: Diagnostic[],
  lineNumber: number,
): FlowPlan {
  if (line === "@input") {
    return { type: "input" };
  }

  const forward = line.match(/^@forward(!)?\s+(c[0-9]+)$/i);
  if (forward) {
    return { type: "forward", target: forward[2], autorun: Boolean(forward[1]) };
  }

  const chain = line.match(/^@chain\s+(.+)$/i);
  if (chain) {
    const nodes = chain[1].split(">").map((part) => part.trim()).filter(Boolean);
    const invalidNode = nodes.find((node) => !/^c[0-9]+$/i.test(node));
    const seen = new Set<string>();
    const loop = nodes.some((node) => {
      if (seen.has(node)) return true;
      seen.add(node);
      return false;
    });

    if (nodes.length < 2) {
      diagnostics.push({ level: "error", line: lineNumber, message: "@chain requires at least two cells." });
    }

    if (invalidNode) {
      diagnostics.push({ level: "error", line: lineNumber, message: `Invalid chain target: ${invalidNode}.` });
    }

    return {
      type: "chain",
      nodes,
      loop,
      iterations: loop ? constraints.iterationsMax ?? options.defaultLoopIterations : undefined,
    };
  }

  if (/@if\b.*>>/.test(line)) {
    diagnostics.push({
      level: "error",
      line: lineNumber,
      message: "Invalid operator `>>`. Supported operators: >, >=, <, <=, ==, !=.",
    });
    return { type: "none" };
  }

  const condition = line.match(
    /^@if\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:(>=|<=|==|!=|>|<)\s*([^\s]+))?\s*->\s*(c[0-9]+|stop|done)$/i,
  );
  if (condition) {
    const elseLine = headerLines.find((candidate) => candidate.trim().startsWith("@else"));
    const elseTarget = elseLine?.trim().match(/^@else\s*->\s*(c[0-9]+|stop|done)$/i)?.[1];
    const expression = {
      raw: [condition[1], condition[2], condition[3]].filter(Boolean).join(" "),
      variable: condition[1],
      operator: condition[2] as ">" | ">=" | "<" | "<=" | "==" | "!=" | undefined,
      value: condition[3] ? parseLiteral(condition[3]) : undefined,
    };

    return {
      type: "if",
      condition: expression.raw,
      expression,
      target: condition[4],
      elseTarget,
    };
  }

  diagnostics.push({ level: "error", line: lineNumber, message: `Unknown flow command: ${line}.` });
  return { type: "none" };
}

function parseElseLine(line: string, diagnostics: Diagnostic[], lineNumber: number): void {
  if (!/^@else\s*->\s*(c[0-9]+|stop|done)$/i.test(line)) {
    diagnostics.push({ level: "error", line: lineNumber, message: "Invalid @else directive. Use `@else -> c4`." });
  }
}

function parseReferences(
  text: string,
  diagnostics: Diagnostic[],
  options: ParseOptions,
): CellReference[] {
  const references: CellReference[] = [];
  const known = new Set(options.knownAliases);
  const cellsByAlias = new Map(options.cells?.map((cell) => [cell.alias, cell]));
  const regex = /\{\{(c[0-9]+)\.([^}]+)\}\}/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const alias = match[1];
    const path = match[2].trim();
    const raw = match[0];

    if (!known.has(alias)) {
      diagnostics.push({ level: "error", message: `Reference error: cell \`${alias}\` not found.` });
    }

    if (supportedReferenceFieldSet.has(path)) {
      references.push({ alias, kind: "field", field: path as CellReference["field"], raw });
      continue;
    }

    if (path.startsWith("vars.")) {
      const variable = path.slice("vars.".length);
      const source = cellsByAlias.get(alias);
      if (source && !(variable in source.vars)) {
        diagnostics.push({
          level: "error",
          message: `Reference error: variable \`${variable}\` not found in ${alias}.vars.`,
        });
      }
      references.push({ alias, kind: "var", variable, raw });
      continue;
    }

    if (path.startsWith("artifact.")) {
      const filename = path.slice("artifact.".length);
      const source = cellsByAlias.get(alias);
      if (source && !findArtifact(source.artifacts, filename)) {
        diagnostics.push({
          level: "error",
          message: `Reference error: artifact \`${filename}\` not found in ${alias}.`,
        });
      }
      references.push({ alias, kind: "artifact", filename, raw });
      continue;
    }

    diagnostics.push({ level: "error", message: `Unknown reference: ${raw}.` });
  }

  return references;
}

function validateFlowTargets(flow: FlowPlan, knownAliases: string[], diagnostics: Diagnostic[]): void {
  const known = new Set(knownAliases);
  const targets =
    flow.type === "forward"
      ? [flow.target]
      : flow.type === "chain"
        ? flow.nodes
        : flow.type === "if"
          ? [flow.target, flow.elseTarget].filter(Boolean)
          : [];

  targets.forEach((target) => {
    if (target === "stop" || target === "done") return;
    if (target && !known.has(target)) {
      diagnostics.push({ level: "error", message: `Cell \`${target}\` not found.` });
    }
  });
}

function validateArtifactUses(
  uses: ArtifactUseDirective[],
  options: ParseOptions,
  diagnostics: Diagnostic[],
): void {
  const known = new Set(options.knownAliases);
  const cellsByAlias = new Map(options.cells?.map((cell) => [cell.alias, cell]));

  uses.forEach((useDirective) => {
    if (!known.has(useDirective.alias)) {
      diagnostics.push({
        level: "error",
        line: useDirective.line,
        message: `Reference error: cell \`${useDirective.alias}\` not found.`,
      });
      return;
    }

    const source = cellsByAlias.get(useDirective.alias);
    if (source && !findArtifact(source.artifacts, useDirective.filename)) {
      diagnostics.push({
        level: "error",
        line: useDirective.line,
        message: `Reference error: artifact \`${useDirective.filename}\` not found in ${useDirective.alias}.`,
      });
    }
  });
}

function createProviderLookup(providerAliases: ProviderAliasOption[] = []): ProviderAliasLookup {
  const byAlias = new Map<string, ProviderAliasEntry>();
  const available: string[] = [];

  function add(id: ProviderId | string, alias: string, label?: string, models?: string[]) {
    const cleanAlias = alias.trim();
    if (!cleanAlias) return;

    const key = normalizeProviderKey(cleanAlias);
    byAlias.set(key, { id, alias: cleanAlias, label, models });
    if (!available.some((candidate) => normalizeProviderKey(candidate) === key)) {
      available.push(cleanAlias);
    }
  }

  KNOWN_PROVIDERS.forEach((provider) => add(provider, provider, providerLabels[provider]));
  providerAliases.forEach((provider) => {
    if (provider.provider) add(provider.id, String(provider.provider), provider.label, provider.models);
    if (!isInternalProviderId(String(provider.id))) add(provider.id, String(provider.id), provider.label, provider.models);
    add(provider.id, provider.alias, provider.label ?? provider.alias, provider.models);
  });

  return { byAlias, available };
}

function isInternalProviderId(value: string): boolean {
  return /^provider[_-]/i.test(value);
}

function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase();
}

function isKnownModel(model: string, available: string[]): boolean {
  const normalized = model.trim().toLowerCase();
  return available.some((candidate) => candidate.trim().toLowerCase() === normalized);
}

function formatAvailableModels(models: string[]): string {
  const visible = models.slice(0, 8);
  return `${visible.join(", ")}${models.length > visible.length ? `, +${models.length - visible.length} more` : ""}`;
}

function buildChips(
  routing: RoutingPlan | undefined,
  constraints: ConstraintPlan,
  flow: FlowPlan,
  outputs: ParsedDsl["outputs"],
  diagnostics: Diagnostic[],
): string[] {
  const chips: string[] = [];

  if (routing) {
    const providerChip =
      routing.mode === "auto"
        ? "auto"
        : routing.providers.map(formatProviderChip).join(routing.mode === "parallel" ? "," : "+");
    if (providerChip) chips.push(providerChip);
    if (routing.mode === "best") chips.push(routing.method ?? "best");
    if (routing.mode === "synthesis") chips.push(routing.method ?? "synthesis");
    if (routing.mode === "parallel") chips.push("multi");
  }

  if (constraints.costMaxUsd) chips.push(`<$${trimNumber(constraints.costMaxUsd)}`);
  if (constraints.latencyMaxSec) chips.push(`<${formatDuration(constraints.latencyMaxSec)}`);
  if (constraints.tokensMax) chips.push(`<${formatTokens(constraints.tokensMax)} tok`);
  if (constraints.iterationsMax) chips.push(`iter ${constraints.iterationsMax}`);

  if (flow.type === "forward") chips.push(`-> ${flow.target}${flow.autorun ? "!" : ""}`);
  if (flow.type === "chain") chips.push(flow.loop ? `loop x${flow.iterations ?? "?"}` : "chain");
  if (flow.type === "if") chips.push("if");

  outputs.files.forEach((file) => chips.push(`${artifactIcon(file.extension)} ${formatExtension(file.extension)}`.trim()));
  if (outputs.text) chips.push(outputs.text.limitChars ? `text <${outputs.text.limitChars}` : "text");
  outputs.uses.forEach((useDirective) => chips.push(`use ${useDirective.alias}/${useDirective.filename}`));

  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) chips.push("header error");

  return chips;
}

function formatProviderChip(provider: ProviderSelection): string {
  const providerName = provider.alias ?? provider.label ?? provider.provider;
  if (provider.model) return `${providerName}:${provider.model}`;
  if (provider.profile && provider.profile !== "default") return `${providerName}.${provider.profile}`;
  return providerName;
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
  if (seconds < 1) return `${seconds * 1000}ms`;
  return `${seconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000 && tokens % 1000 === 0) return `${tokens / 1000}k`;
  return String(tokens);
}

function formatExtension(extension?: string): string {
  return extension ? extension.replace(".", "") : "";
}

function artifactIcon(extension?: string): string {
  if (!extension) return "file";
  if ([".json", ".yaml", ".yml"].includes(extension)) return "json";
  if ([".csv", ".xlsx"].includes(extension)) return "table";
  if (extension === ".html") return "html";
  if ([".diff", ".patch"].includes(extension)) return "diff";
  if ([".py", ".ts", ".tsx", ".js", ".jsx", ".sql"].includes(extension)) return "{}";
  return "file";
}

function validateFileExtension(extension: string, diagnostics: Diagnostic[], line: number): void {
  if (!supportedFileExtensionSet.has(extension)) {
    diagnostics.push({
      level: "error",
      line,
      message: `Unsupported file type \`${extension}\` in v1.2. Supported: ${[...SUPPORTED_FILE_EXTENSIONS].join(", ")}.`,
    });
  }
}

function findArtifact(artifacts: Artifact[], filename: string): Artifact | undefined {
  return artifacts.find((artifact) => artifact.displayName === filename && artifact.status === "created");
}

function parseLiteral(value: string): number | string | boolean {
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value.replace(/^["']|["']$/g, "");
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
