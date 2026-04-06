export type QualityLabel = "SD" | "HD" | "FULL_HD" | "UNKNOWN";

export type AnalyzeResultKind =
  | "success"
  | "unsupported"
  | "invalid_url"
  | "network_error";

export type MediaVariant = {
  id: string;
  downloadUrl: string;
  mimeType: string;
  container: "mp4" | "unknown";
  width?: number;
  height?: number;
  bitrateKbps?: number;
  fileSizeBytesEstimate?: number;
  qualityLabel: QualityLabel;
};

export type ResolvedMedia = {
  sourceUrl: string;
  canonicalUrl: string;
  title?: string;
  creatorName?: string;
  creatorHandle?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  variants: MediaVariant[];
};

export type AnalyzeResponse =
  | {
      kind: "success";
      media: ResolvedMedia;
      message?: string;
    }
  | {
      kind: Exclude<AnalyzeResultKind, "success">;
      message: string;
    };

export type DownloadHistoryEntry = {
  id: string;
  addedAt: string;
  sourceUrl: string;
  canonicalUrl: string;
  title?: string;
  creatorName?: string;
  creatorHandle?: string;
  thumbnailUrl?: string;
  qualityLabel: QualityLabel;
  mimeType: string;
  container: string;
  resolution: string;
  fileSizeLabel: string;
};
