export type OutputChannel = "file" | "image";

export type GeneratorKind =
  | "llm_text"
  | "llm_code"
  | "llm_structured"
  | "llm_vector"
  | "renderer"
  | "image_executor";

export interface FormatRegistryEntry {
  formatId: string;
  label: string;
  defaultExtension: string;
  allowedExtensions: string[];
  mimeType: string;
  generatorKind: GeneratorKind;
  requiredCapability: string;
  validator: string;
  viewer: string;
  isDirectLlmGeneratable: boolean;
  channel: OutputChannel;
}

export const FILE_FORMATS: FormatRegistryEntry[] = [
  {
    formatId: "markdown",
    label: "Markdown document",
    defaultExtension: ".md",
    allowedExtensions: [".md"],
    mimeType: "text/markdown",
    generatorKind: "llm_text",
    requiredCapability: "text_generation",
    validator: "markdown_basic",
    viewer: "preview_source",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "text",
    label: "Plain text",
    defaultExtension: ".txt",
    allowedExtensions: [".txt"],
    mimeType: "text/plain",
    generatorKind: "llm_text",
    requiredCapability: "text_generation",
    validator: "text_basic",
    viewer: "preview_source",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "html",
    label: "HTML document",
    defaultExtension: ".html",
    allowedExtensions: [".html", ".htm"],
    mimeType: "text/html",
    generatorKind: "llm_text",
    requiredCapability: "text_generation",
    validator: "html_basic",
    viewer: "preview_source",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "xml",
    label: "XML document",
    defaultExtension: ".xml",
    allowedExtensions: [".xml"],
    mimeType: "application/xml",
    generatorKind: "llm_text",
    requiredCapability: "text_generation",
    validator: "xml_basic",
    viewer: "preview_source",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "json",
    label: "JSON",
    defaultExtension: ".json",
    allowedExtensions: [".json"],
    mimeType: "application/json",
    generatorKind: "llm_structured",
    requiredCapability: "text_generation",
    validator: "json_strict",
    viewer: "structured_raw",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "yaml",
    label: "YAML",
    defaultExtension: ".yaml",
    allowedExtensions: [".yaml", ".yml"],
    mimeType: "application/yaml",
    generatorKind: "llm_structured",
    requiredCapability: "text_generation",
    validator: "yaml_parse",
    viewer: "structured_raw",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "csv",
    label: "CSV table",
    defaultExtension: ".csv",
    allowedExtensions: [".csv"],
    mimeType: "text/csv",
    generatorKind: "llm_structured",
    requiredCapability: "text_generation",
    validator: "csv_basic",
    viewer: "table",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "toml",
    label: "TOML",
    defaultExtension: ".toml",
    allowedExtensions: [".toml"],
    mimeType: "application/toml",
    generatorKind: "llm_structured",
    requiredCapability: "text_generation",
    validator: "toml_parse",
    viewer: "structured_raw",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "ini",
    label: "INI config",
    defaultExtension: ".ini",
    allowedExtensions: [".ini"],
    mimeType: "text/plain",
    generatorKind: "llm_structured",
    requiredCapability: "text_generation",
    validator: "ini_basic",
    viewer: "structured_raw",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "env",
    label: "ENV file",
    defaultExtension: ".env",
    allowedExtensions: [".env"],
    mimeType: "text/plain",
    generatorKind: "llm_structured",
    requiredCapability: "text_generation",
    validator: "env_basic",
    viewer: "structured_raw",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "svg",
    label: "SVG vector image",
    defaultExtension: ".svg",
    allowedExtensions: [".svg"],
    mimeType: "image/svg+xml",
    generatorKind: "llm_vector",
    requiredCapability: "text_generation",
    validator: "svg_sanitized",
    viewer: "preview_source",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "mermaid",
    label: "Mermaid diagram",
    defaultExtension: ".mmd",
    allowedExtensions: [".mmd", ".mermaid"],
    mimeType: "text/plain",
    generatorKind: "llm_vector",
    requiredCapability: "text_generation",
    validator: "mermaid_optional",
    viewer: "preview_source",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "diff",
    label: "Patch / diff",
    defaultExtension: ".diff",
    allowedExtensions: [".diff", ".patch"],
    mimeType: "text/x-diff",
    generatorKind: "llm_vector",
    requiredCapability: "text_generation",
    validator: "diff_basic",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "python",
    label: "Python code",
    defaultExtension: ".py",
    allowedExtensions: [".py"],
    mimeType: "text/x-python",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "python_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "javascript",
    label: "JavaScript",
    defaultExtension: ".js",
    allowedExtensions: [".js"],
    mimeType: "text/javascript",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "javascript_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "typescript",
    label: "TypeScript",
    defaultExtension: ".ts",
    allowedExtensions: [".ts"],
    mimeType: "text/typescript",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "typescript_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "jsx",
    label: "JSX",
    defaultExtension: ".jsx",
    allowedExtensions: [".jsx"],
    mimeType: "text/javascript",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "javascript_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "tsx",
    label: "TSX",
    defaultExtension: ".tsx",
    allowedExtensions: [".tsx"],
    mimeType: "text/typescript",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "typescript_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "go",
    label: "Go",
    defaultExtension: ".go",
    allowedExtensions: [".go"],
    mimeType: "text/x-go",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "go_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "rust",
    label: "Rust",
    defaultExtension: ".rs",
    allowedExtensions: [".rs"],
    mimeType: "text/rust",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "rust_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "java",
    label: "Java",
    defaultExtension: ".java",
    allowedExtensions: [".java"],
    mimeType: "text/x-java-source",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "java_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "kotlin",
    label: "Kotlin",
    defaultExtension: ".kt",
    allowedExtensions: [".kt"],
    mimeType: "text/x-kotlin",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "kotlin_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "swift",
    label: "Swift",
    defaultExtension: ".swift",
    allowedExtensions: [".swift"],
    mimeType: "text/x-swift",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "swift_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "objective_c",
    label: "Objective-C",
    defaultExtension: ".m",
    allowedExtensions: [".m", ".h"],
    mimeType: "text/x-objective-c",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "objective_c_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "cpp",
    label: "C++",
    defaultExtension: ".cpp",
    allowedExtensions: [".cpp", ".hpp", ".cc", ".cxx", ".h"],
    mimeType: "text/x-c++src",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "cpp_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "c",
    label: "C",
    defaultExtension: ".c",
    allowedExtensions: [".c", ".h"],
    mimeType: "text/x-csrc",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "c_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "shell",
    label: "Shell script",
    defaultExtension: ".sh",
    allowedExtensions: [".sh"],
    mimeType: "text/x-shellscript",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "shell_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "sql",
    label: "SQL",
    defaultExtension: ".sql",
    allowedExtensions: [".sql"],
    mimeType: "application/sql",
    generatorKind: "llm_code",
    requiredCapability: "text_generation",
    validator: "sql_syntax_optional",
    viewer: "code_editor",
    isDirectLlmGeneratable: true,
    channel: "file",
  },
  {
    formatId: "pdf",
    label: "Rendered PDF",
    defaultExtension: ".pdf",
    allowedExtensions: [".pdf"],
    mimeType: "application/pdf",
    generatorKind: "renderer",
    requiredCapability: "pdf_renderer",
    validator: "pdf_header",
    viewer: "document_viewer",
    isDirectLlmGeneratable: false,
    channel: "file",
  },
  {
    formatId: "docx",
    label: "Word document",
    defaultExtension: ".docx",
    allowedExtensions: [".docx"],
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    generatorKind: "renderer",
    requiredCapability: "docx_renderer",
    validator: "docx_open",
    viewer: "document_viewer",
    isDirectLlmGeneratable: false,
    channel: "file",
  },
  {
    formatId: "xlsx",
    label: "Spreadsheet",
    defaultExtension: ".xlsx",
    allowedExtensions: [".xlsx"],
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    generatorKind: "renderer",
    requiredCapability: "xlsx_renderer",
    validator: "xlsx_open",
    viewer: "table",
    isDirectLlmGeneratable: false,
    channel: "file",
  },
];

export const IMAGE_FORMATS: FormatRegistryEntry[] = [
  {
    formatId: "png",
    label: "PNG image",
    defaultExtension: ".png",
    allowedExtensions: [".png"],
    mimeType: "image/png",
    generatorKind: "image_executor",
    requiredCapability: "image_generation",
    validator: "png_decode",
    viewer: "image_viewer",
    isDirectLlmGeneratable: false,
    channel: "image",
  },
  {
    formatId: "jpg",
    label: "JPEG image",
    defaultExtension: ".jpg",
    allowedExtensions: [".jpg", ".jpeg"],
    mimeType: "image/jpeg",
    generatorKind: "image_executor",
    requiredCapability: "image_generation",
    validator: "jpeg_decode",
    viewer: "image_viewer",
    isDirectLlmGeneratable: false,
    channel: "image",
  },
  {
    formatId: "webp",
    label: "WebP image",
    defaultExtension: ".webp",
    allowedExtensions: [".webp"],
    mimeType: "image/webp",
    generatorKind: "image_executor",
    requiredCapability: "image_generation",
    validator: "webp_decode",
    viewer: "image_viewer",
    isDirectLlmGeneratable: false,
    channel: "image",
  },
];

export const FORMAT_REGISTRY = [...FILE_FORMATS, ...IMAGE_FORMATS] as const;
export const SUPPORTED_FILE_EXTENSIONS = FILE_FORMATS.flatMap((format) => format.allowedExtensions);
export const SUPPORTED_IMAGE_EXTENSIONS = IMAGE_FORMATS.flatMap((format) => format.allowedExtensions);

export const BINARY_FILE_EXTENSIONS = new Set([
  ".zip",
  ".exe",
  ".bin",
  ".pt",
  ".pth",
  ".onnx",
  ".mp4",
  ".mov",
  ".avi",
  ".wav",
  ".mp3",
  ".flac",
  ".dmg",
  ".pkg",
]);

const fileFormatById = new Map(FILE_FORMATS.map((format) => [normalizeFormatId(format.formatId), format]));
const imageFormatById = new Map(IMAGE_FORMATS.map((format) => [normalizeFormatId(format.formatId), format]));
const fileFormatByExtension = new Map<string, FormatRegistryEntry>();
const imageFormatByExtension = new Map<string, FormatRegistryEntry>();

for (const format of FILE_FORMATS) {
  for (const extension of format.allowedExtensions) {
    if (!fileFormatByExtension.has(extension)) fileFormatByExtension.set(extension, format);
  }
}

for (const format of IMAGE_FORMATS) {
  for (const extension of format.allowedExtensions) {
    imageFormatByExtension.set(extension, format);
  }
}

export function normalizeFormatId(value: string): string {
  return value.trim().replace(/^-/, "").toLowerCase();
}

export function getFileFormatById(formatId: string): FormatRegistryEntry | undefined {
  return fileFormatById.get(normalizeFormatId(formatId));
}

export function getImageFormatById(formatId: string): FormatRegistryEntry | undefined {
  return imageFormatById.get(normalizeFormatId(formatId));
}

export function getFileFormatByExtension(extension: string): FormatRegistryEntry | undefined {
  return fileFormatByExtension.get(extension.toLowerCase());
}

export function getImageFormatByExtension(extension: string): FormatRegistryEntry | undefined {
  return imageFormatByExtension.get(extension.toLowerCase());
}
