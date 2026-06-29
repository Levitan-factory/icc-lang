export type ProviderId =
  | "openai"
  | "anthropic"
  | "claude"
  | "gemini"
  | "xai"
  | "mistral"
  | "deepseek"
  | "openrouter"
  | "local";

export type ProviderKind = Exclude<ProviderId, "claude"> | "custom";

export type CellStatus =
  | "not_run"
  | "running"
  | "completed"
  | "partial_failed"
  | "failed"
  | "skipped"
  | "stale"
  | "parse_error"
  | "reference_error"
  | "decision_error"
  | "config_error"
  | "artifact_error"
  | "timeout"
  | "cancelled";

export type CellViewMode = "expanded" | "compact";
export type NotebookCellKind = "intent" | "text";
export type DiagnosticLevel = "error" | "warning" | "info";
export type SaveStatus = "saved" | "saving" | "unsaved" | "failed" | "offline";

export interface Diagnostic {
  level: DiagnosticLevel;
  line?: number;
  code?: string;
  message: string;
}

export interface ProviderSelection {
  provider: ProviderId | string;
  alias?: string;
  label?: string;
  model?: string;
  profile?: "default" | "max" | "ensemble" | "cheap" | "fast" | "code" | "reasoning" | "flash";
}

export type RoutingMode = "single" | "parallel" | "best" | "synthesis" | "auto" | "fast" | "cheap";

export type RoutingMethod = "best" | "max" | "synthesis" | "ensemble";

export interface RoutingPlan {
  mode: RoutingMode;
  providers: ProviderSelection[];
  raw: string;
  method?: RoutingMethod;
}

export interface ConstraintPlan {
  costMaxUsd?: number;
  latencyMaxSec?: number;
  tokensMax?: number;
  iterationsMax?: number;
}

export interface ConditionExpression {
  raw: string;
  variable: string;
  operator?: ">" | ">=" | "<" | "<=" | "==" | "!=";
  value?: number | string | boolean;
}

export type FlowPlan =
  | { type: "none" }
  | { type: "input" }
  | { type: "forward"; target: string; targets?: string[]; autorun: boolean }
  | { type: "chain"; nodes: string[]; loop: boolean; iterations?: number }
  | {
      type: "if";
      condition: string;
      expression?: ConditionExpression;
      target: string;
      elseTarget?: string;
    };

export type ReferenceKind =
  | "input"
  | "from"
  | "output"
  | "var"
  | "file"
  | "files"
  | "prompt"
  | "header"
  | "meta"
  | "error"
  | "field"
  | "artifact";

export interface CellReference {
  alias?: string;
  kind: ReferenceKind;
  field?: "output" | "prompt" | "header" | "status";
  variable?: string;
  filename?: string;
  metaKey?: string;
  path?: string[];
  raw: string;
  legacy?: boolean;
}

export interface BodySegment {
  type: "source_text" | "sender_note";
  text: string;
  line?: number;
}

export interface TextOutputDirective {
  enabled: boolean;
  limitChars?: number;
  raw: string;
  line?: number;
}

export interface FileOutputDirective {
  channel?: "file";
  requested: string;
  formatId?: string;
  name?: string;
  extension?: string;
  mimeType?: string;
  generatorKind?: string;
  requiredCapability?: string;
  viewer?: string;
  autoName: boolean;
  autoType: boolean;
  autoSelect?: boolean;
  autoSelected?: boolean;
  raw: string;
  line?: number;
}

export interface ImageOutputDirective {
  channel: "image";
  requested: string;
  formatId: string;
  name?: string;
  extension?: string;
  mimeType?: string;
  generatorKind?: string;
  requiredCapability?: string;
  viewer?: string;
  autoName: boolean;
  autoType: boolean;
  autoSelect?: boolean;
  autoSelected?: boolean;
  raw: string;
  line?: number;
}

export interface ArtifactUseDirective {
  alias: string;
  filename: string;
  raw: string;
  line?: number;
}

export interface OutputPlan {
  text?: TextOutputDirective;
  files: FileOutputDirective[];
  images: ImageOutputDirective[];
  uses: ArtifactUseDirective[];
}

export interface ParsedDsl {
  routing?: RoutingPlan;
  constraints: ConstraintPlan;
  flow: FlowPlan;
  outputs: OutputPlan;
  bodySegments?: BodySegment[];
  senderNotes?: string[];
  references: CellReference[];
  dependencies: string[];
  chips: string[];
  diagnostics: Diagnostic[];
}

export type ParsedVars = Record<string, string | number | boolean>;

export interface DecisionResult {
  conditionRaw: string;
  variable: string;
  operator?: string;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
  result?: boolean;
  routeTarget?: string;
  skippedTargets: string[];
  error?: string;
}

export type ArtifactStatus = "created" | "failed";
export type CellAttachmentEncoding = "text" | "base64";

export interface Artifact {
  id: string;
  projectId?: string;
  notebookId?: string;
  cellId: string;
  cellAlias: string;
  runId: string;
  displayName: string;
  extension: string;
  mimeType: string;
  version: number;
  storageKey: string;
  sizeBytes: number;
  content: string;
  status: ArtifactStatus;
  error?: string;
  createdAt: string;
  metadata: {
    autoNamed: boolean;
    channel?: "file" | "image";
    formatId?: string;
    generatorKind?: string;
    viewer?: string;
    source: "llm_output" | "manual";
  };
}

export interface CellAttachment {
  id: string;
  cellId: string;
  displayName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
  encoding: CellAttachmentEncoding;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: CellStatus;
  costUsd: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  summary: string;
  providerRuns: Array<{
    provider: string;
    model: string;
    status: CellStatus;
  }>;
  inputResolved: string;
  textOutputRaw: string;
  textOutputVisible: string;
  vars: ParsedVars;
  decision?: DecisionResult;
  artifacts: Artifact[];
  executionPlan: string[];
  errors: Diagnostic[];
}

export interface NotebookCell {
  id: string;
  kind: NotebookCellKind;
  alias: string;
  title: string;
  noteBody?: string;
  controlHeader: string;
  promptBody: string;
  output: string;
  status: CellStatus;
  viewMode: CellViewMode;
  collapsedPrompt: boolean;
  collapsedOutput: boolean;
  vars: ParsedVars;
  attachments: CellAttachment[];
  artifacts: Artifact[];
  decision?: DecisionResult;
  staleReason?: string;
  lastRun?: RunRecord;
  runHistory: RunRecord[];
  createdAt: string;
  updatedAt: string;
}

export type NotebookDslChannel = "stable" | "preview" | "experimental";

export interface NotebookMetadata {
  dsl_version: string;
  dsl_version_label: string;
  dsl_channel: NotebookDslChannel;
  runtime: "icc-go";
  created_with: string;
  created_at: string;
  migrated_from?: string[];
}

export interface Notebook {
  id: string;
  title: string;
  description: string;
  metadata: NotebookMetadata;
  cellAliasCounter: number;
  cells: NotebookCell[];
  snapshots: NotebookSnapshot[];
  viewState: {
    mode: CellViewMode;
    sidebarVisible: boolean;
    inspectorVisible: boolean;
    showArtifacts: boolean;
    showExecutionMetadata: boolean;
    showCellIds: boolean;
    showDslPreview: boolean;
  };
  createdAt: string;
  lastSavedAt?: string;
  updatedAt: string;
}

export interface NotebookSnapshot {
  id: string;
  notebookId: string;
  name: string;
  note?: string;
  state: Notebook;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  notebooks: Notebook[];
  createdAt: string;
  updatedAt: string;
}

export interface ProviderSettings {
  id: string;
  provider: ProviderKind;
  label: string;
  alias: string;
  enabled: boolean;
  apiKeyMasked: string;
  defaultModel: string;
  maxModel: string;
  ensembleModel: string;
  imageModel: string;
  cheapModel: string;
  fastModel: string;
  codeModel: string;
  contextLimit: number;
  modelCatalog?: Array<{ label: string; value: string }>;
  modelCatalogUpdatedAt?: string;
  modelCatalogSource?: "fallback" | "provider-api" | "public-api";
  balance: ProviderBalanceStatus;
}

export type ProviderBalanceState = "unchecked" | "ok" | "warning" | "error";

export interface ProviderBalanceStatus {
  state: ProviderBalanceState;
  message: string;
  remainingCreditsUsd?: number;
  checkedAt?: string;
}

export interface OrchestrationSettings {
  selectorModel: string;
  synthesisModel: string;
  evaluatorModel: string;
  defaultCostCapUsd: number;
  defaultLatencyCapSec: number;
  defaultLoopIterations: number;
  maxLoopIterations: number;
  fallbackProvider: string;
  retryPolicy: "none" | "once" | "exponential";
}

export interface WorkspaceSettings {
  providers: ProviderSettings[];
  orchestration: OrchestrationSettings;
}

export interface WorkspaceState {
  projects: Project[];
  activeProjectId: string;
  activeNotebookId: string;
  selectedCellId?: string;
  settings: WorkspaceSettings;
}
