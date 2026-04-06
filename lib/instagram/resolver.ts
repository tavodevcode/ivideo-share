import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AnalyzeResponse, MediaVariant, ResolvedMedia } from "@/lib/types";
import { pickBestVariant, qualityFromResolution } from "@/lib/utils";

const execFileAsync = promisify(execFile);

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com"
]);

const DOWNLOAD_HOST_ALLOWLIST = [
  /(^|\.)instagram\.com$/i,
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)fbcdn\.net$/i
];

const PUBLIC_PATH_PATTERN = /^\/(reel|reels|p|tv)\//i;

export function normalizeInstagramUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());

    if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) {
      return null;
    }

    if (!PUBLIC_PATH_PATTERN.test(parsed.pathname)) {
      return null;
    }

    parsed.search = "";
    parsed.hash = "";

    const normalizedPath = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
}

export function isAllowedDownloadUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return DOWNLOAD_HOST_ALLOWLIST.some((pattern) => pattern.test(parsed.hostname));
  } catch {
    return false;
  }
}

export async function analyzeInstagramUrl(rawUrl: string): Promise<AnalyzeResponse> {
  const normalizedUrl = normalizeInstagramUrl(rawUrl);

  if (!normalizedUrl) {
    return {
      kind: "invalid_url",
      message: "Pega una URL publica valida de Instagram para un post o reel con video."
    };
  }

  try {
    const html = await fetchInstagramHtml(normalizedUrl);
    let resolved = extractResolvedMedia(html, normalizedUrl);

    if (!resolved) {
      const embedHtml = await fetchInstagramHtml(buildEmbedCaptionedUrl(normalizedUrl));
      resolved = extractResolvedMedia(embedHtml, normalizedUrl);
    }

    if (!resolved) {
      return {
        kind: "unsupported",
        message:
          "No pude encontrar un video publico descargable en esa pagina. Prueba con otro reel o post publico."
      };
    }

    const bestVariant = pickBestVariant(resolved.variants);
    if (!bestVariant) {
      return {
        kind: "unsupported",
        message: "La publicacion se resolvio, pero no trajo variantes de video descargables."
      };
    }

    return {
      kind: "success",
      media: {
        ...resolved,
        variants: [bestVariant]
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo analizar la URL.";
    return {
      kind: "network_error",
      message
    };
  }
}

async function fetchInstagramHtml(url: string): Promise<string> {
  if (process.env.NODE_ENV === "test") {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-MX,es;q=0.9,en;q=0.8"
      },
      redirect: "follow",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Instagram respondio con estado ${response.status}.`);
    }

    return response.text();
  }

  return requestHtml(url);
}

async function requestHtml(url: string): Promise<string> {
  const curlArgs = [
    "-sS",
    "-L",
    "--max-time",
    "15",
    "-w",
    "\n__CURL_STATUS__:%{http_code}\n",
    url
  ];

  try {
    const { stdout } = await execFileAsync("curl", curlArgs, {
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024
    });
    const marker = "\n__CURL_STATUS__:";
    const markerIndex = stdout.lastIndexOf(marker);

    if (markerIndex === -1) {
      throw new Error("No pude determinar el estado de la respuesta de Instagram.");
    }

    const html = stdout.slice(0, markerIndex);
    const status = Number(stdout.slice(markerIndex + marker.length).trim());

    if (!Number.isFinite(status) || status < 200 || status >= 400) {
      throw new Error(`Instagram respondio con estado ${status}.`);
    }

    return html;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("No se pudo recuperar el HTML de Instagram.");
  }
}

function extractResolvedMedia(html: string, sourceUrl: string): ResolvedMedia | null {
  const candidates = collectJsonCandidates(html);
  const mediaRecords = candidates
    .flatMap((candidate) => extractMediaRecords(candidate))
    .filter((record): record is ExtractedMediaRecord => Boolean(record.videoUrl));
  const metaFallback = extractOpenGraphRecord(html);
  const escapedEmbedFallback = extractEscapedEmbedRecord(html);

  if (metaFallback?.videoUrl) {
    mediaRecords.push(metaFallback);
  }

  if (escapedEmbedFallback?.videoUrl) {
    mediaRecords.push(escapedEmbedFallback);
  }

  if (mediaRecords.length === 0) {
    return null;
  }

  const bestRecord = mediaRecords.sort((a, b) => compareRecordScore(b) - compareRecordScore(a))[0];
  const variants = bestRecord.videoUrl
    ? [
        buildVariant({
          url: bestRecord.videoUrl,
          width: bestRecord.width,
          height: bestRecord.height,
          bitrateKbps: bestRecord.bitrateKbps,
          mimeType: bestRecord.mimeType,
          fileSizeBytesEstimate: bestRecord.fileSizeBytesEstimate
        })
      ]
    : [];

  if (variants.length === 0) {
    return null;
  }

  return {
    sourceUrl,
    canonicalUrl: bestRecord.canonicalUrl ?? sourceUrl,
    title: bestRecord.title,
    creatorName: bestRecord.creatorName,
    creatorHandle: bestRecord.creatorHandle,
    thumbnailUrl: bestRecord.thumbnailUrl,
    durationMs: bestRecord.durationSec ? bestRecord.durationSec * 1000 : undefined,
    variants
  };
}

type ExtractedMediaRecord = {
  canonicalUrl?: string;
  title?: string;
  creatorName?: string;
  creatorHandle?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  videoUrl?: string;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  fileSizeBytesEstimate?: number;
  mimeType?: string;
};

function buildVariant({
  url,
  width,
  height,
  bitrateKbps,
  mimeType,
  fileSizeBytesEstimate
}: {
  url: string;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  mimeType?: string;
  fileSizeBytesEstimate?: number;
}): MediaVariant {
  return {
    id: createStableId(url),
    downloadUrl: url,
    mimeType: mimeType ?? "video/mp4",
    container: mimeType?.includes("mp4") ?? true ? "mp4" : "unknown",
    width,
    height,
    bitrateKbps,
    fileSizeBytesEstimate,
    qualityLabel: qualityFromResolution(width, height)
  };
}

function createStableId(input: string): string {
  return Buffer.from(input).toString("base64url").slice(0, 18);
}

function compareRecordScore(record: ExtractedMediaRecord): number {
  return (
    (record.width ?? 0) * (record.height ?? 0) +
    (record.bitrateKbps ?? 0) * 100 +
    (record.fileSizeBytesEstimate ?? 0) / 1024
  );
}

function collectJsonCandidates(html: string): unknown[] {
  const candidates = collectJsonCandidatesFromHtml(html);
  const deescapedHtml = deescapeHtmlPayload(html);

  if (deescapedHtml !== html) {
    candidates.push(...collectJsonCandidatesFromHtml(deescapedHtml));
  }

  return candidates;
}

function collectJsonCandidatesFromHtml(html: string): unknown[] {
  const candidates: unknown[] = [];
  const scriptRegex = /<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRegex)) {
    const parsed = safeJsonParse(match[1]?.trim());
    if (parsed !== undefined) {
      candidates.push(parsed);
    }
  }

  const dataRegexes = [
    /"xdt_shortcode_media":(\{[\s\S]*?\})(?:,"xdt_api__v1__media__shortcode__web_info"|,"shortcode_media")/g,
    /"shortcode_media":(\{[\s\S]*?\})(?:,"site_data"|,"gating_info")/g,
    /"video_url":"(.*?)"/g
  ];

  for (const pattern of dataRegexes) {
    for (const match of html.matchAll(pattern)) {
      if (pattern === dataRegexes[2]) {
        const url = decodeEscapedUrl(match[1]);
        if (url) {
          candidates.push({ video_url: url });
        }
        continue;
      }

      const parsed = safeJsonParse(match[1]);
      if (parsed !== undefined) {
        candidates.push(parsed);
      }
    }
  }

  const balancedObjectMarkers = [
    '"gql_data":{"shortcode_media":',
    '"shortcode_media":',
    '"xdt_shortcode_media":'
  ];

  for (const marker of balancedObjectMarkers) {
    const extracted = extractBalancedObjectAfterMarker(html, marker);
    if (extracted) {
      const parsed = safeJsonParse(extracted);
      if (parsed !== undefined) {
        candidates.push(parsed);
      }
    }
  }

  return candidates;
}

function extractOpenGraphRecord(html: string): ExtractedMediaRecord | null {
  const videoUrl = extractMetaContent(html, "og:video") ?? extractMetaContent(html, "og:video:url");

  if (!videoUrl) {
    return null;
  }

  const thumbnailUrl = extractMetaContent(html, "og:image");

  return {
    canonicalUrl: extractMetaContent(html, "og:url") ?? undefined,
    title: extractMetaContent(html, "og:title") ?? undefined,
    thumbnailUrl: thumbnailUrl ? decodeEscapedUrl(thumbnailUrl) : undefined,
    videoUrl: decodeEscapedUrl(videoUrl),
    mimeType: "video/mp4"
  };
}

function extractEscapedEmbedRecord(html: string): ExtractedMediaRecord | null {
  const videoUrl = extractEscapedField(html, "video_url");

  if (!videoUrl) {
    return null;
  }

  const dimensions = extractEscapedDimensions(html);
  const thumbnailUrl = extractEscapedField(html, "display_url") ?? extractMetaContent(html, "og:image");
  const creatorHandle = extractEscapedField(html, "username");

  return {
    canonicalUrl: extractMetaContent(html, "og:url") ?? undefined,
    title: extractMetaContent(html, "og:title") ?? undefined,
    creatorHandle: creatorHandle ? creatorHandle.replace(/^@+/, "") : undefined,
    thumbnailUrl: thumbnailUrl ? decodeEscapedUrl(thumbnailUrl) : undefined,
    videoUrl: decodeEscapedUrl(videoUrl),
    width: dimensions?.width,
    height: dimensions?.height,
    mimeType: "video/mp4"
  };
}

function extractMediaRecords(candidate: unknown): ExtractedMediaRecord[] {
  const records: ExtractedMediaRecord[] = [];
  walkCandidate(candidate, (value) => {
    if (!value || typeof value !== "object") {
      return;
    }

    const record = createMediaRecord(value as Record<string, unknown>);
    if (record.videoUrl) {
      records.push(record);
    }
  });

  return records;
}

function walkCandidate(value: unknown, visitor: (value: unknown) => void): void {
  visitor(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      walkCandidate(entry, visitor);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      walkCandidate(entry, visitor);
    }
  }
}

function createMediaRecord(raw: Record<string, unknown>): ExtractedMediaRecord {
  const dimensions = raw.dimensions && typeof raw.dimensions === "object"
    ? (raw.dimensions as Record<string, unknown>)
    : undefined;
  const videoVersions = Array.isArray(raw.video_versions)
    ? raw.video_versions.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    : [];

  const bestVersion = videoVersions.sort(compareVideoVersions)[0];
  const thumbnailResources = Array.isArray(raw.display_resources)
    ? raw.display_resources.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    : [];
  const bestThumbnail = thumbnailResources.sort(compareMediaSizes)[thumbnailResources.length - 1];

  const videoUrl = firstString([
    raw.video_url,
    bestVersion?.url,
    raw.contentUrl,
    raw.embedUrl
  ]);
  const thumbnailUrl = firstString([raw.thumbnail_url, raw.display_url, raw.image, bestThumbnail?.src]);
  const owner = raw.owner && typeof raw.owner === "object" ? (raw.owner as Record<string, unknown>) : undefined;

  return {
    canonicalUrl: firstString([
      raw.video_url ? undefined : raw.contentUrl,
      raw.permalink,
      raw.url
    ]),
    title: firstString([raw.title, raw.caption, raw.accessibility_caption]),
    creatorName: firstString([owner?.full_name, owner?.name]),
    creatorHandle: normalizeCreatorHandle(firstString([owner?.username, raw.username, raw.author])),
    thumbnailUrl: thumbnailUrl ? decodeEscapedUrl(thumbnailUrl) : undefined,
    durationSec: firstNumber([raw.video_duration, raw.duration]),
    videoUrl: videoUrl ? decodeEscapedUrl(videoUrl) : undefined,
    width: firstNumber([raw.width, dimensions?.width, bestVersion?.width]),
    height: firstNumber([raw.height, dimensions?.height, bestVersion?.height]),
    bitrateKbps: firstNumber([bestVersion?.bit_rate, raw.bitrate])
      ? Math.round(firstNumber([bestVersion?.bit_rate, raw.bitrate])! / 1000)
      : undefined,
    fileSizeBytesEstimate: firstNumber([bestVersion?.file_size, raw.contentSize]),
    mimeType: firstString([bestVersion?.mime_type, raw.encodingFormat])
  };
}

function compareVideoVersions(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return compareByDimensions(b, a);
}

function compareMediaSizes(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return compareByDimensions(a, b);
}

function compareByDimensions(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aScore = (firstNumber([a.width]) ?? 0) * (firstNumber([a.height]) ?? 0);
  const bScore = (firstNumber([b.width]) ?? 0) * (firstNumber([b.height]) ?? 0);
  return aScore - bScore;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function normalizeCreatorHandle(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replace(/^@+/, "").trim() || undefined;
}

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function safeJsonParse(payload: string | undefined): unknown | undefined {
  if (!payload) {
    return undefined;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function decodeEscapedUrl(value: string): string {
  let decoded = value;

  for (let index = 0; index < 3; index += 1) {
    decoded = decoded
      .replace(/\\u0026/gi, "&")
      .replace(/\\u00253d/gi, "%3D")
      .replace(/\\u00252f/gi, "%2F")
      .replace(/\\u0025/gi, "%")
      .replace(/\\+\//g, "/");
  }

  return decoded;
}

function extractMetaContent(html: string, property: string): string | null {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapedProperty}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  return pattern.exec(html)?.[1] ?? null;
}

function buildEmbedCaptionedUrl(url: string): string {
  return url.endsWith("/") ? `${url}embed/captioned/` : `${url}/embed/captioned/`;
}

function extractBalancedObjectAfterMarker(html: string, marker: string): string | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const startIndex = markerIndex + marker.length;
  if (html[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < html.length; index += 1) {
    const character = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === "\"") {
        inString = false;
      }

      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function deescapeHtmlPayload(html: string): string {
  return html
    .replace(/\\"/g, "\"")
    .replace(/\\\\\//g, "\\/")
    .replace(/\\u003C/gi, "<")
    .replace(/\\u003E/gi, ">")
    .replace(/\\u0026/gi, "&");
}

function extractEscapedField(html: string, fieldName: string): string | undefined {
  const marker = `\\"${fieldName}\\":\\"`;
  const startIndex = html.indexOf(marker);

  if (startIndex < 0) {
    return undefined;
  }

  const valueStart = startIndex + marker.length;
  const valueEnd = html.indexOf('\\"', valueStart);

  if (valueEnd < 0) {
    return undefined;
  }

  return html.slice(valueStart, valueEnd);
}

function extractEscapedDimensions(html: string): { width?: number; height?: number } | null {
  return {
    width: extractEscapedNumber(html, "width"),
    height: extractEscapedNumber(html, "height")
  };
}

function extractEscapedNumber(html: string, fieldName: string): number | undefined {
  const marker = `\\"${fieldName}\\":`;
  const startIndex = html.indexOf(marker);

  if (startIndex < 0) {
    return undefined;
  }

  const numberStart = startIndex + marker.length;
  const slice = html.slice(numberStart, numberStart + 12);
  const match = /^\d+/.exec(slice);
  return match ? Number(match[0]) : undefined;
}
