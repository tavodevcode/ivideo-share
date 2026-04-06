import type { MediaVariant, QualityLabel } from "@/lib/types";

export function formatBytes(bytes?: number): string {
  if (!bytes || Number.isNaN(bytes)) {
    return "No disponible";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDuration(durationMs?: number): string {
  if (!durationMs) {
    return "No disponible";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatResolution(width?: number, height?: number): string {
  if (!width || !height) {
    return "No disponible";
  }

  return `${width} x ${height}`;
}

export function pickBestVariant(variants: MediaVariant[]): MediaVariant | undefined {
  return [...variants].sort(compareVariants)[0];
}

export function compareVariants(a: MediaVariant, b: MediaVariant): number {
  return scoreVariant(b) - scoreVariant(a);
}

export function qualityFromResolution(width?: number, height?: number): QualityLabel {
  const maxDimension = Math.max(width ?? 0, height ?? 0);

  if (!maxDimension) {
    return "UNKNOWN";
  }

  if (maxDimension >= 1900) {
    return "FULL_HD";
  }

  if (maxDimension >= 1000) {
    return "HD";
  }

  return "SD";
}

function scoreVariant(variant: MediaVariant): number {
  const qualityScore = {
    UNKNOWN: 0,
    SD: 1,
    HD: 2,
    FULL_HD: 3
  }[variant.qualityLabel];

  return (
    qualityScore * 1_000_000 +
    (variant.width ?? 0) * (variant.height ?? 0) +
    (variant.bitrateKbps ?? 0) * 100 +
    (variant.fileSizeBytesEstimate ?? 0) / 1024
  );
}
