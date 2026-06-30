export type IccLanguageChannel = "stable" | "preview" | "experimental";

export interface IccLanguageChannelRecord {
  channel: IccLanguageChannel;
  target: string;
  version: string;
  label: string;
  stability: "draft-public" | "stable" | "preview" | "experimental";
  publicDefault: boolean;
  docsPath: string;
  branchPrefix: string;
  description: string;
}

export const ICC_LANGUAGE_CHANNELS = {
  stable: {
    channel: "stable",
    target: "v1_04",
    version: "1.04.0",
    label: "v1.04",
    stability: "stable",
    publicDefault: true,
    docsPath: "/reference/",
    branchPrefix: "lang/stable/",
    description: "Public ICC DSL syntax supported by ICC-GO and the public reference site.",
  },
  preview: {
    channel: "preview",
    target: "v1_05",
    version: "1.05.0-preview.0",
    label: "v1.05-preview",
    stability: "preview",
    publicDefault: false,
    docsPath: "/versions/",
    branchPrefix: "lang/preview/",
    description: "Candidate syntax under review before it is promoted to the stable public channel.",
  },
  experimental: {
    channel: "experimental",
    target: "v1_04",
    version: "1.04.0",
    label: "v1.04-experimental",
    stability: "experimental",
    publicDefault: false,
    docsPath: "/versions/",
    branchPrefix: "lang/experimental/",
    description: "Research syntax and implementation experiments that are not normative.",
  },
} as const satisfies Record<IccLanguageChannel, IccLanguageChannelRecord>;

export const PUBLIC_LANGUAGE_CHANNEL = ICC_LANGUAGE_CHANNELS.stable;
export const PREVIEW_LANGUAGE_CHANNEL = ICC_LANGUAGE_CHANNELS.preview;
export const EXPERIMENTAL_LANGUAGE_CHANNEL = ICC_LANGUAGE_CHANNELS.experimental;
