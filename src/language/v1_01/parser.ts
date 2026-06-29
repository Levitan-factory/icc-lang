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

export const PROVIDER_PROFILES = ["default", "max", "ensemble", "cheap", "fast", "code", "reasoning", "flash"] as const;
export const ROUTING_MODES = ["single", "parallel", "best", "synthesis", "auto", "fast", "cheap"] as const;
export const CONDITION_OPERATORS = [">", ">=", "<", "<=", "==", "!="] as const;
export const SUPPORTED_REFERENCE_FIELDS = [
  "input",
  "output",
  "var",
  "file",
  "files",
  "prompt",
  "header",
  "meta",
  "error",
] as const;
export const SUPPORTED_FILE_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".py",
  ".js",
  ".ts",
  ".html",
  ".diff",
] as const;

const supportedFileExtensionSet = new Set<string>(SUPPORTED_FILE_EXTENSIONS);
const reservedReferencePrefixes = ["input", "output", "var", "file", "files", "prompt", "header", "meta", "error"];
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
      flow = parseFlow(line, headerLines, constraints, options, diagnostics, lineNumber, flow);
      continue;
    }

    diagnostics.push({
      level: "warning",
      line: lineNumber,
      message: "Control header lines should start with >, <, @, or an escape.",
    });
  }

  const references = parseReferences(`${controlHeader}\n${promptBody}`, diagnostics, options);
  const dependencies = buildDependencies(references);

  if (/(^|\s)@input(\s|$)/.test(promptBody)) {
    diagnostics.push({
      level: "warning",
      message: "`@input` is deprecated in ICC v1.01. Use `%input` in the prompt body.",
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

export function hasLegacyIccSyntax(value: string): boolean {
  return /\{\{c[0-9]+\.[^}]+\}\}/i.test(value) || /(^|\s)@input(\s|$)/.test(value);
}

export function migrateLegacyIccSyntax(value: string): string {
  return value
    .replace(/\{\{(c[0-9]+)\.output\}\}/gi, "%output.$1")
    .replace(/\{\{(c[0-9]+)\.prompt\}\}/gi, "%prompt.$1")
    .replace(/\{\{(c[0-9]+)\.header\}\}/gi, "%header.$1")
    .replace(/\{\{(c[0-9]+)\.vars\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gi, "%var.$1.$2")
    .replace(/\{\{(c[0-9]+)\.metadata\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gi, "%meta.$1.$2")
    .replace(/\{\{(c[0-9]+)\.meta\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gi, "%meta.$1.$2")
    .replace(/\{\{(c[0-9]+)\.artifact\.([^}]+)\}\}/gi, "%file.$1:$2")
    .replace(/\{\{(c[0-9]+)\.artifacts\}\}/gi, "%files.$1")
    .replace(/(^|\s)@input(?=\s|$)/g, "$1%input");
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

  const lowerRaw = raw.toLowerCase();
  if (lowerRaw === "auto" || lowerRaw === "fast" || lowerRaw === "cheap" || lowerRaw === "best") {
    return { mode: lowerRaw as RoutingPlan["mode"], providers: [], raw };
  }

  const grouped = raw.match(/^\((.+)\)(?:\.(best|max|synthesis|ensemble))?$/i);
  if (grouped) {
    const providerParts = grouped[1].split("+").map((part) => part.trim());
    const emptyPart = providerParts.findIndex((part) => !part);
    if (emptyPart >= 0) {
      diagnostics.push({ level: "error", line, message: "Missing provider in routing group." });
    }
    const providers = providerParts
      .filter(Boolean)
      .map((part) => parseProvider(part, diagnostics, line, providerLookup));
    const method = grouped[2]?.toLowerCase() as RoutingPlan["method"] | undefined;
    return {
      mode: method ? (method === "best" || method === "max" ? "best" : "synthesis") : "parallel",
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
  const providerMatch = raw.match(
    /^([a-zA-Z0-9_-]+)(?::([a-zA-Z0-9_./:-]+))?(?:\.(max|ensemble|cheap|fast|code|reasoning|flash))?$/i,
  );

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

  const tokens = normalized.match(/^tokens\s*<=\s*([0-9]+)$/i) ?? normalized.match(/^([0-9]+)\s*tok(?:ens)?$/i);
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
      level: "warning",
      line: lineNumber,
      message: "File has no extension. ICC will infer type or fallback to .md.",
    });
    return { requested, autoName: true, autoType: true, raw: line, line: lineNumber };
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
  currentFlow: FlowPlan,
): FlowPlan {
  if (line === "@input") {
    diagnostics.push({
      level: "warning",
      line: lineNumber,
      message: "`@input` is deprecated in ICC v1.01. Use `%input` in the prompt body.",
    });
    return currentFlow;
  }

  const forward = line.match(/^@forward(!)?\s+(c[0-9]+)$/i);
  if (forward) {
    if (currentFlow.type === "forward") {
      return {
        type: "forward",
        target: currentFlow.target,
        targets: [...(currentFlow.targets ?? [currentFlow.target]), forward[2]],
        autorun: currentFlow.autorun || Boolean(forward[1]),
      };
    }
    return { type: "forward", target: forward[2], targets: [forward[2]], autorun: Boolean(forward[1]) };
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
    /^@if\s+(%var\.c[0-9]+\.[a-zA-Z_][a-zA-Z0-9_]*|[a-zA-Z_][a-zA-Z0-9_]*)\s*(?:(>=|<=|==|!=|>|<)\s*([^\s]+))?\s*->\s*(c[0-9]+|stop|done)$/i,
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
  const nativeRegex =
    /(^|[^%])%(input|output\.(c[0-9]+)|var\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_]*)|file\.(c[0-9]+)(?::([^\s%,.?!;:]+(?:\.[^\s%,.?!;:]+)*))?|files\.(c[0-9]+)|prompt\.(c[0-9]+)|header\.(c[0-9]+)|meta\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_]*)|error\.(c[0-9]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = nativeRegex.exec(text)) !== null) {
    const raw = match[0].startsWith("%") ? match[0] : match[0].slice(match[1].length);
    const expression = raw.slice(1);

    if (expression === "input") {
      references.push({ kind: "input", raw });
      continue;
    }

    const reference = parseNativeReference(raw, expression, known, cellsByAlias, diagnostics);
    if (reference) references.push(reference);
  }

  const legacyRegex = /\{\{(c[0-9]+)\.([^}]+)\}\}/gi;
  while ((match = legacyRegex.exec(text)) !== null) {
    const alias = match[1];
    const path = match[2].trim();
    const raw = match[0];
    const migrated = migrateLegacyReference(raw);

    diagnostics.push({
      level: "warning",
      message: `Legacy reference ${raw} detected. Use ${migrated ?? "ICC v1.01 % syntax"} instead.`,
    });

    if (!known.has(alias)) {
      diagnostics.push({ level: "error", message: `Reference error: cell \`${alias}\` not found.` });
    }

    if (path === "output" || path === "prompt" || path === "header" || path === "status") {
      references.push({
        alias,
        kind: path === "status" ? "meta" : path,
        field: path as CellReference["field"],
        metaKey: path === "status" ? "status" : undefined,
        raw,
        legacy: true,
      });
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
      references.push({ alias, kind: "var", variable, raw, legacy: true });
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
      references.push({ alias, kind: "file", filename, raw, legacy: true });
      continue;
    }

    if (path === "artifacts") {
      references.push({ alias, kind: "files", raw, legacy: true });
      continue;
    }

    diagnostics.push({ level: "error", message: `Unknown reference: ${raw}.` });
  }

  return references;
}

function parseNativeReference(
  raw: string,
  expression: string,
  known: Set<string>,
  cellsByAlias: Map<string, Pick<NotebookCell, "alias" | "vars" | "artifacts">>,
  diagnostics: Diagnostic[],
): CellReference | undefined {
  const cellMatch = expression.match(/^(output|file|files|prompt|header|error)\.(c[0-9]+)(?::(.+))?$/i);
  if (cellMatch) {
    const kind = cellMatch[1].toLowerCase() as CellReference["kind"];
    const alias = cellMatch[2];
    const filename = cellMatch[3]?.trim();
    validateReferenceCell(alias, known, diagnostics);

    if (kind === "file" && filename) {
      validateArtifactReference(alias, filename, cellsByAlias, diagnostics);
    }

    return { alias, kind, filename, raw };
  }

  const varMatch = expression.match(/^var\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (varMatch) {
    const alias = varMatch[1];
    const variable = varMatch[2];
    validateReferenceCell(alias, known, diagnostics);
    return { alias, kind: "var", variable, raw };
  }

  const metaMatch = expression.match(/^meta\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (metaMatch) {
    const alias = metaMatch[1];
    validateReferenceCell(alias, known, diagnostics);
    return { alias, kind: "meta", metaKey: metaMatch[2], raw };
  }

  if (reservedReferencePrefixes.some((prefix) => expression.startsWith(`${prefix}.`) || expression === prefix)) {
    diagnostics.push({ level: "error", message: `Invalid ICC reference: ${raw}.` });
  }

  return undefined;
}

function validateReferenceCell(alias: string, known: Set<string>, diagnostics: Diagnostic[]): void {
  if (!known.has(alias)) {
    diagnostics.push({ level: "error", message: `Reference error: cell \`${alias}\` not found.` });
  }
}

function validateArtifactReference(
  alias: string,
  filename: string,
  cellsByAlias: Map<string, Pick<NotebookCell, "alias" | "vars" | "artifacts">>,
  diagnostics: Diagnostic[],
): void {
  const source = cellsByAlias.get(alias);
  if (source && source.artifacts.length > 0 && !findArtifact(source.artifacts, filename)) {
    diagnostics.push({
      level: "error",
      message: `Reference error: artifact \`${filename}\` not found in ${alias}.`,
    });
  }
}

function buildDependencies(references: CellReference[]): string[] {
  return [...new Set(references.map((reference) => reference.alias).filter((alias): alias is string => Boolean(alias)))];
}

function migrateLegacyReference(raw: string): string | undefined {
  const migrated = migrateLegacyIccSyntax(raw);
  return migrated === raw ? undefined : migrated;
}

function validateFlowTargets(flow: FlowPlan, knownAliases: string[], diagnostics: Diagnostic[]): void {
  const known = new Set(knownAliases);
  const targets =
    flow.type === "forward"
      ? flow.targets ?? [flow.target]
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
      routing.providers.length === 0
        ? routing.mode
        : routing.providers.map(formatProviderChip).join(routing.mode === "parallel" ? "," : "+");
    if (providerChip) chips.push(providerChip);
    if (routing.providers.length > 0 && routing.mode === "best") chips.push(routing.method ?? "best");
    if (routing.providers.length > 0 && routing.mode === "synthesis") chips.push(routing.method ?? "synthesis");
    if (routing.providers.length > 0 && routing.mode === "parallel") chips.push("multi");
  }

  if (constraints.costMaxUsd) chips.push(`<$${trimNumber(constraints.costMaxUsd)}`);
  if (constraints.latencyMaxSec) chips.push(`<${formatDuration(constraints.latencyMaxSec)}`);
  if (constraints.tokensMax) chips.push(`<${formatTokens(constraints.tokensMax)} tok`);
  if (constraints.iterationsMax) chips.push(`iter ${constraints.iterationsMax}`);

  if (flow.type === "forward") {
    const targets = flow.targets ?? [flow.target];
    chips.push(`-> ${targets.join(",")}${flow.autorun ? "!" : ""}`);
  }
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
      message: `Unsupported file type \`${extension}\` in ICC v1.01. Supported: ${[...SUPPORTED_FILE_EXTENSIONS].join(", ")}.`,
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
