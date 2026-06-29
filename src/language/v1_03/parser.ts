import type {
  Artifact,
  ArtifactUseDirective,
  CellReference,
  ConstraintPlan,
  Diagnostic,
  FileOutputDirective,
  FlowPlan,
  ImageOutputDirective,
  NotebookCell,
  ParsedDsl,
  ProviderId,
  ProviderSelection,
  RoutingPlan,
  TextOutputDirective,
} from "../../domain/types";
import {
  BINARY_FILE_EXTENSIONS,
  FILE_FORMATS,
  IMAGE_FORMATS,
  SUPPORTED_FILE_EXTENSIONS,
  getFileFormatByExtension,
  getFileFormatById,
  getImageFormatByExtension,
  getImageFormatById,
  normalizeFormatId,
  type FormatRegistryEntry,
} from "./formatRegistry";

export { SUPPORTED_FILE_EXTENSIONS, SUPPORTED_IMAGE_EXTENSIONS } from "./formatRegistry";

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
  "from",
  "file",
  "files",
  "prompt",
  "header",
  "meta",
  "error",
] as const;

const reservedReferencePrefixes = ["from", "input", "output", "var", "file", "files", "prompt", "header", "meta", "error"];
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

export interface MigrateLegacyOptions {
  inputSourceAlias?: string;
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

type ArtifactOutputDirective = FileOutputDirective | ImageOutputDirective;

const MAX_ARTIFACT_RANGE_ITEMS = 50;

export function parseCellDsl(
  controlHeader: string,
  promptBody: string,
  options: ParseOptions,
): ParsedDsl {
  const diagnostics: Diagnostic[] = [];
  const constraints: ConstraintPlan = {};
  const files: FileOutputDirective[] = [];
  const images: ImageOutputDirective[] = [];
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
      files.push(...parseFileDirective(line, diagnostics, lineNumber));
      continue;
    }

    if (line.startsWith("@image")) {
      images.push(...parseImageDirective(line, diagnostics, lineNumber));
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
      message: "`@input` is legacy syntax. Use `%from cN` in the prompt body.",
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

  const outputs = { text, files, images, uses };

  return {
    routing,
    constraints,
    flow,
    outputs,
    references,
    dependencies,
    chips: buildChips(routing, constraints, flow, outputs, diagnostics, references),
    diagnostics,
  };
}

export function getSupportedFileExtensions(): string[] {
  return [...SUPPORTED_FILE_EXTENSIONS];
}

export function getSupportedFileFormats(): FormatRegistryEntry[] {
  return [...FILE_FORMATS];
}

export function getSupportedImageFormats(): FormatRegistryEntry[] {
  return [...IMAGE_FORMATS];
}

export function getSupportedReferenceFields(): string[] {
  return [...SUPPORTED_REFERENCE_FIELDS];
}

export function hasLegacyIccSyntax(value: string): boolean {
  return (
    /\{\{c[0-9]+\.[^}]+\}\}/i.test(value) ||
    /(^|\s)@input(\s|$)/.test(value) ||
    /^@forward!\s+c[0-9]+/im.test(value) ||
    /(^|[^%])%input\b/i.test(value) ||
    /(^|[^%])%output\.c[0-9]+(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/i.test(value) ||
    /(^|[^%])%var\.c[0-9]+\.[a-zA-Z_][a-zA-Z0-9_]*/i.test(value)
  );
}

export function migrateLegacyIccSyntax(value: string, options: MigrateLegacyOptions = {}): string {
  return value
    .replace(/^(\s*)@forward!\s+(c[0-9]+)\s*$/gim, "$1@forward $2")
    .replace(/\{\{(c[0-9]+)\.output\}\}/gi, "%from $1")
    .replace(/\{\{(c[0-9]+)\.prompt\}\}/gi, "%prompt.$1")
    .replace(/\{\{(c[0-9]+)\.header\}\}/gi, "%header.$1")
    .replace(/\{\{(c[0-9]+)\.vars\.([a-zA-Z_][a-zA-Z0-9_.-]*)\}\}/gi, "%from $1.$2")
    .replace(/\{\{(c[0-9]+)\.metadata\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gi, "%meta.$1.$2")
    .replace(/\{\{(c[0-9]+)\.meta\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gi, "%meta.$1.$2")
    .replace(/\{\{(c[0-9]+)\.artifact\.([^}]+)\}\}/gi, "%file.$1:$2")
    .replace(/\{\{(c[0-9]+)\.artifacts\}\}/gi, "%files.$1")
    .replace(/(^|[^%])%output\.(c[0-9]+)((?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi, "$1%from $2$3")
    .replace(/(^|[^%])%var\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_.-]*)/gi, "$1%from $2.$3")
    .replace(/(^|[^%])%input\b/gi, (_match, prefix: string) =>
      options.inputSourceAlias ? `${prefix}%from ${options.inputSourceAlias}` : `${prefix}%input`,
    )
    .replace(/(^|\s)@input(?=\s|$)/g, (_match, prefix: string) =>
      options.inputSourceAlias ? `${prefix}%from ${options.inputSourceAlias}` : `${prefix}%input`,
    );
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
): FileOutputDirective[] {
  const match = line.match(/^@file(?:\s+(.+))?$/);
  if (!match) {
    diagnostics.push({ level: "error", line: lineNumber, message: "Invalid @file directive." });
    return [];
  }

  const requested = match[1]?.trim() ?? "";
  return parseArtifactDirectives("file", requested, line, diagnostics, lineNumber) as FileOutputDirective[];
}

function parseImageDirective(
  line: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): ImageOutputDirective[] {
  const match = line.match(/^@image(?:\s+(.+))?$/);
  if (!match) {
    diagnostics.push({ level: "error", line: lineNumber, message: "Invalid @image directive." });
    return [];
  }

  const requested = match[1]?.trim() ?? "";
  return parseArtifactDirectives("image", requested, line, diagnostics, lineNumber) as ImageOutputDirective[];
}

function parseArtifactDirectives(
  channel: "file" | "image",
  requested: string,
  raw: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): ArtifactOutputDirective[] {
  return expandArtifactRange(requested, diagnostics, lineNumber)
    .map((expandedRequest) => parseArtifactDirective(channel, expandedRequest, raw, diagnostics, lineNumber))
    .filter(isArtifactDirective);
}

function expandArtifactRange(requested: string, diagnostics: Diagnostic[], lineNumber: number): string[] {
  if (!requested) return [requested];

  const matches = [...requested.matchAll(/\{(\d+)\.\.(\d+)\}/g)];
  if (matches.length === 0) return [requested];

  if (matches.length > 1) {
    diagnostics.push(
      outputDiagnostic({
        code: "artifact_range_multiple",
        line: lineNumber,
        message: "artifact_range_multiple: use one numeric range per artifact directive.",
      }),
    );
    return [];
  }

  const match = matches[0];
  const fullRange = match[0];
  const startRaw = match[1];
  const endRaw = match[2];
  const start = Number(startRaw);
  const end = Number(endRaw);
  const total = Math.abs(end - start) + 1;

  if (total > MAX_ARTIFACT_RANGE_ITEMS) {
    diagnostics.push(
      outputDiagnostic({
        code: "artifact_range_too_large",
        line: lineNumber,
        message: `artifact_range_too_large: filename range expands to ${total} artifacts; maximum is ${MAX_ARTIFACT_RANGE_ITEMS}.`,
      }),
    );
    return [];
  }

  const width = startRaw.startsWith("0") || endRaw.startsWith("0") ? Math.max(startRaw.length, endRaw.length) : 0;
  const step = start <= end ? 1 : -1;

  return Array.from({ length: total }, (_item, index) => {
    const value = formatArtifactRangeNumber(start + index * step, width);
    return requested.replace(fullRange, value);
  });
}

function formatArtifactRangeNumber(value: number, width: number): string {
  return width > 0 ? String(value).padStart(width, "0") : String(value);
}

function isArtifactDirective(directive: ArtifactOutputDirective | undefined): directive is ArtifactOutputDirective {
  return Boolean(directive);
}

function parseArtifactDirective(
  channel: "file" | "image",
  requested: string,
  raw: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): FileOutputDirective | ImageOutputDirective | undefined {
  if (!requested) {
    const format = channel === "file" ? getFileFormatById("markdown") : getImageFormatById("png");
    return {
      channel,
      requested: "",
      formatId: "auto",
      extension: format?.defaultExtension,
      mimeType: format?.mimeType,
      generatorKind: format?.generatorKind,
      requiredCapability: format?.requiredCapability,
      viewer: format?.viewer,
      autoName: true,
      autoType: true,
      autoSelect: true,
      raw,
      line: lineNumber,
    };
  }

  if (requested.startsWith("-")) {
    return parseExplicitFormatDirective(channel, requested, raw, diagnostics, lineNumber);
  }

  if (/^\.[a-zA-Z0-9]+$/.test(requested)) {
    const extension = requested.toLowerCase();
    return parseExtensionOnlyDirective(channel, requested, extension, raw, diagnostics, lineNumber);
  }

  return parseNamedDirective(channel, requested, raw, diagnostics, lineNumber);
}

function parseExplicitFormatDirective(
  channel: "file" | "image",
  requested: string,
  raw: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): FileOutputDirective | ImageOutputDirective | undefined {
  const [formatToken, ...filenameParts] = requested.split(/\s+/);
  const formatId = normalizeFormatId(formatToken);
  const format = channel === "file" ? getFileFormatById(formatId) : getImageFormatById(formatId);
  const wrongChannelFormat = channel === "file" ? getImageFormatById(formatId) : getFileFormatById(formatId);
  const filenameRaw = filenameParts.join(" ").trim();

  if (!format) {
    diagnostics.push(
      outputDiagnostic({
        code: wrongChannelFormat && channel === "file" ? "image_format_requires_image_channel" : "unsupported_format",
        line: lineNumber,
        message:
          wrongChannelFormat && channel === "file"
            ? `Image format \`-${formatId}\` requires @image, not @file.`
            : `Unsupported ${channel} format \`-${formatId}\`.`,
      }),
    );
    return undefined;
  }

  const normalizedName = filenameRaw ? completeFilename(filenameRaw, format, diagnostics, lineNumber) : undefined;
  const extension = normalizedName ? extractExtension(normalizedName) ?? format.defaultExtension : format.defaultExtension;

  if (normalizedName && !format.allowedExtensions.includes(extension)) {
    diagnostics.push(
      outputDiagnostic({
        code: "format_extension_mismatch",
        line: lineNumber,
        message: `format_extension_mismatch: \`-${format.formatId}\` expects ${format.allowedExtensions.join(", ")}, but filename uses \`${extension}\`.`,
      }),
    );
  }

  return buildOutputDirective(channel, requested, raw, lineNumber, format, normalizedName, {
    autoName: !normalizedName,
    autoType: false,
    autoSelect: false,
    extension,
  });
}

function parseExtensionOnlyDirective(
  channel: "file" | "image",
  requested: string,
  extension: string,
  raw: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): FileOutputDirective | ImageOutputDirective | undefined {
  const format = channel === "file" ? getFileFormatByExtension(extension) : getImageFormatByExtension(extension);
  const wrongChannelFormat = channel === "file" ? getImageFormatByExtension(extension) : getFileFormatByExtension(extension);

  if (!format) {
    pushExtensionError(channel, extension, wrongChannelFormat, diagnostics, lineNumber);
    return undefined;
  }

  return buildOutputDirective(channel, requested, raw, lineNumber, format, undefined, {
    autoName: true,
    autoType: false,
    autoSelect: false,
    extension,
  });
}

function parseNamedDirective(
  channel: "file" | "image",
  requested: string,
  raw: string,
  diagnostics: Diagnostic[],
  lineNumber: number,
): FileOutputDirective | ImageOutputDirective | undefined {
  const legacy = requested.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s+(.+)$/);
  const legacyFormat = legacy && channel === "file" ? getFileFormatById(legacy[1]) : undefined;
  if (legacyFormat) {
    const legacyFilename = legacy?.[2].trim() ?? "";
    diagnostics.push(
      outputDiagnostic({
        code: "legacy_file_format_syntax",
        level: "warning",
        line: lineNumber,
        message: `legacy_file_format_syntax: use @file -${legacyFormat.formatId} ${legacyFilename} instead.`,
      }),
    );
    return parseExplicitFormatDirective(channel, `-${legacyFormat.formatId} ${legacyFilename}`, raw, diagnostics, lineNumber);
  }

  const extension = extractExtension(requested);
  if (!extension) {
    if (channel === "image") {
      diagnostics.push(
        outputDiagnostic({
          code: "unsupported_format",
          line: lineNumber,
          message: "unsupported_format: @image filenames need .png, .jpg, .jpeg, or .webp, or use @image -png.",
        }),
      );
      return undefined;
    }

    const format = getFileFormatById("markdown");
    diagnostics.push({
      level: "warning",
      line: lineNumber,
      message: "File has no extension. ICC will save it as Markdown; use @file -<format> name for another type.",
    });
    return format
      ? buildOutputDirective(channel, requested, raw, lineNumber, format, `${requested}${format.defaultExtension}`, {
          autoName: false,
          autoType: true,
          autoSelect: true,
          extension: format.defaultExtension,
        })
      : undefined;
  }

  const format = channel === "file" ? getFileFormatByExtension(extension) : getImageFormatByExtension(extension);
  const wrongChannelFormat = channel === "file" ? getImageFormatByExtension(extension) : getFileFormatByExtension(extension);

  if (!format) {
    pushExtensionError(channel, extension, wrongChannelFormat, diagnostics, lineNumber);
    return undefined;
  }

  if (/\s/.test(requested)) {
    diagnostics.push({
      level: "warning",
      line: lineNumber,
      message: "Artifact filenames should avoid spaces. Use snake_case or kebab-case.",
    });
  }

  return buildOutputDirective(channel, requested, raw, lineNumber, format, requested, {
    autoName: false,
    autoType: false,
    autoSelect: false,
    extension,
  });
}

function buildOutputDirective(
  channel: "file" | "image",
  requested: string,
  raw: string,
  line: number,
  format: FormatRegistryEntry,
  name: string | undefined,
  options: {
    autoName: boolean;
    autoType: boolean;
    autoSelect: boolean;
    extension: string;
  },
): FileOutputDirective | ImageOutputDirective {
  return {
    channel,
    requested,
    formatId: options.autoSelect && !requested ? "auto" : format.formatId,
    name,
    extension: options.extension,
    mimeType: format.mimeType,
    generatorKind: format.generatorKind,
    requiredCapability: format.requiredCapability,
    viewer: format.viewer,
    autoName: options.autoName,
    autoType: options.autoType,
    autoSelect: options.autoSelect,
    raw,
    line,
  };
}

function completeFilename(
  filename: string,
  format: FormatRegistryEntry,
  diagnostics: Diagnostic[],
  line: number,
): string {
  if (/\s/.test(filename)) {
    diagnostics.push({
      level: "warning",
      line,
      message: "Artifact filenames should avoid spaces. Use snake_case or kebab-case.",
    });
  }

  const extension = extractExtension(filename);
  return extension ? filename : `${filename}${format.defaultExtension}`;
}

function extractExtension(filename: string): string | undefined {
  const lastSegment = filename.trim().split(/[\\/]/).pop() ?? filename;
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0 || dot === lastSegment.length - 1) return undefined;
  return lastSegment.slice(dot).toLowerCase();
}

function pushExtensionError(
  channel: "file" | "image",
  extension: string,
  wrongChannelFormat: FormatRegistryEntry | undefined,
  diagnostics: Diagnostic[],
  line: number,
): void {
  if (channel === "file" && wrongChannelFormat?.channel === "image") {
    diagnostics.push(
      outputDiagnostic({
        code: "image_format_requires_image_channel",
        line,
        message: `image_format_requires_image_channel: \`${extension}\` requires @image, not @file.`,
      }),
    );
    return;
  }

  if (channel === "file" && BINARY_FILE_EXTENSIONS.has(extension)) {
    diagnostics.push(
      outputDiagnostic({
        code: "binary_format_not_directly_generatable",
        line,
        message: `binary_format_not_directly_generatable: \`${extension}\` cannot be generated directly by an LLM.`,
      }),
    );
    return;
  }

  diagnostics.push(
    outputDiagnostic({
      code: wrongChannelFormat ? "capability_mismatch" : "unknown_extension",
      line,
      message: wrongChannelFormat
        ? `capability_mismatch: \`${extension}\` belongs to ${wrongChannelFormat.channel} outputs.`
        : `unknown_extension: \`${extension}\` is not registered for @${channel}.`,
    }),
  );
}

function outputDiagnostic(input: {
  code: string;
  message: string;
  line: number;
  level?: Diagnostic["level"];
}): Diagnostic {
  return {
    level: input.level ?? "error",
    line: input.line,
    code: input.code,
    message: input.message,
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
      message: "`@input` is legacy syntax. Use `%from cN` in the prompt body.",
    });
    return currentFlow;
  }

  const forward = line.match(/^@forward(!)?\s+(c[0-9]+)$/i);
  if (forward) {
    if (forward[1]) {
      diagnostics.push({
        level: "warning",
        line: lineNumber,
        message: "`@forward!` is legacy syntax. Use active `@forward cN`.",
      });
    }
    if (currentFlow.type === "forward") {
      return {
        type: "forward",
        target: currentFlow.target,
        targets: [...(currentFlow.targets ?? [currentFlow.target]), forward[2]],
        autorun: true,
      };
    }
    return { type: "forward", target: forward[2], targets: [forward[2]], autorun: true };
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
    /(^|[^%])%(from\s+c[0-9]+(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)*|input|output\.(c[0-9]+)(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)?|var\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_.-]*)|file\.(c[0-9]+)(?::([^\s%,.?!;:]+(?:\.[^\s%,.?!;:]+)*))?|files\.(c[0-9]+)|prompt\.(c[0-9]+)|header\.(c[0-9]+)|meta\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_]*)|error\.(c[0-9]+)(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)*)/gi;
  let match: RegExpExecArray | null;

  while ((match = nativeRegex.exec(text)) !== null) {
    const raw = match[0].startsWith("%") ? match[0] : match[0].slice(match[1].length);
    const expression = raw.slice(1);

    if (expression === "input") {
      diagnostics.push({
        level: "warning",
        message: "Legacy reference `%input` detected. Use `%from cN` with an explicit source cell.",
      });
      references.push({ kind: "input", raw, legacy: true });
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
      message: `Legacy reference ${raw} detected. Use ${migrated ?? "current ICC %from syntax"} instead.`,
    });

    if (!known.has(alias)) {
      diagnostics.push({ level: "error", message: `Reference error: cell \`${alias}\` not found.` });
    }

    if (path === "output" || path === "prompt" || path === "header" || path === "status") {
      references.push({
        alias,
        kind: path === "output" ? "from" : path === "status" ? "meta" : path,
        field: path as CellReference["field"],
        metaKey: path === "status" ? "status" : undefined,
        path: path === "output" ? [] : undefined,
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
      references.push({ alias, kind: "from", path: variable.split("."), raw, legacy: true });
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
  const fromMatch = expression.match(/^from\s+(c[0-9]+)((?:\.[a-zA-Z_][a-zA-Z0-9_-]*)*)$/i);
  if (fromMatch) {
    const alias = fromMatch[1];
    const path = fromMatch[2] ? fromMatch[2].slice(1).split(".").filter(Boolean) : [];
    validateReferenceCell(alias, known, diagnostics);
    return { alias, kind: "from", path, raw };
  }

  const cellMatch = expression.match(/^(output|file|files|prompt|header|error)\.(c[0-9]+)((?:\.[a-zA-Z_][a-zA-Z0-9_-]*)*)(?::(.+))?$/i);
  if (cellMatch) {
    const kind = cellMatch[1].toLowerCase() as CellReference["kind"];
    const alias = cellMatch[2];
    const path = cellMatch[3] ? cellMatch[3].slice(1).split(".").filter(Boolean) : [];
    const filename = cellMatch[4]?.trim();
    validateReferenceCell(alias, known, diagnostics);

    if (kind === "file" && filename) {
      validateArtifactReference(alias, filename, cellsByAlias, diagnostics);
    }

    if (kind === "output") {
      diagnostics.push({
        level: "warning",
        message: `Legacy reference ${raw} detected. Use %from ${alias}${path.length ? `.${path.join(".")}` : ""} instead.`,
      });
      return { alias, kind: "from", path, filename, raw, legacy: true };
    }

    return { alias, kind, path: kind === "error" ? path : undefined, filename, raw };
  }

  const varMatch = expression.match(/^var\.(c[0-9]+)\.([a-zA-Z_][a-zA-Z0-9_.-]*)$/i);
  if (varMatch) {
    const alias = varMatch[1];
    const variable = varMatch[2];
    validateReferenceCell(alias, known, diagnostics);
    diagnostics.push({
      level: "warning",
      message: `Legacy reference ${raw} detected. Use %from ${alias}.${variable} instead.`,
    });
    return { alias, kind: "from", variable, path: variable.split("."), raw, legacy: true };
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
  references: CellReference[],
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
    chips.push(`-> ${targets.join(",")}`);
  }
  if (flow.type === "chain") chips.push(flow.loop ? `loop x${flow.iterations ?? "?"}` : "chain");
  if (flow.type === "if") chips.push("if");

  outputs.files.forEach((file) => chips.push(`file: ${file.formatId === "auto" ? "auto" : file.formatId}`));
  outputs.images.forEach((image) => chips.push(`image: ${image.formatId === "auto" ? "auto" : image.formatId}`));
  if (outputs.text) chips.push(outputs.text.limitChars ? `text <${outputs.text.limitChars}` : "text");
  outputs.uses.forEach((useDirective) => chips.push(`use ${useDirective.alias}/${useDirective.filename}`));

  const fromAliases = new Set(
    references
      .filter((reference) => reference.kind === "from" && reference.alias && !(reference.path?.length))
      .map((reference) => reference.alias!),
  );
  fromAliases.forEach((alias) => chips.push(`from ${alias}`));

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
