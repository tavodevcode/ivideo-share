"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AnalyzeResponse, DownloadHistoryEntry, ResolvedMedia } from "@/lib/types";
import { formatBytes, formatDuration, formatResolution, pickBestVariant } from "@/lib/utils";

const HISTORY_STORAGE_KEY = "ivideo-share.history";
const HISTORY_LIMIT = 6;

type ScreenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; media: ResolvedMedia }
  | { status: "error"; tone: "error" | "warning"; message: string };

type PosterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; dataUrl: string }
  | { status: "error" };

type ActivityState = "idle" | "analyzing" | "downloading";

export function HomePage() {
  const [url, setUrl] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>({ status: "idle" });
  const [history, setHistory] = useState<DownloadHistoryEntry[]>([]);
  const [posterState, setPosterState] = useState<PosterState>({ status: "idle" });
  const [activityState, setActivityState] = useState<ActivityState>("idle");
  const [isPending, startTransition] = useTransition();
  const downloadResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  useEffect(() => {
    return () => {
      if (downloadResetTimeoutRef.current !== null) {
        window.clearTimeout(downloadResetTimeoutRef.current);
      }
    };
  }, []);

  const currentVariant = useMemo(() => {
    return screenState.status === "ready" ? pickBestVariant(screenState.media.variants) : undefined;
  }, [screenState]);

  function handleAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      setActivityState("analyzing");
      setScreenState({ status: "loading" });

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ url })
        });

        const result = (await response.json()) as AnalyzeResponse;

        if (result.kind !== "success") {
          setScreenState({
            status: "error",
            tone: result.kind === "unsupported" ? "warning" : "error",
            message: result.message
          });
          setActivityState("idle");
          return;
        }

        setScreenState({ status: "ready", media: result.media });
        const updatedHistory = writeHistory(result.media);
        setHistory(updatedHistory);
        setActivityState("idle");
      } catch {
        setScreenState({
          status: "error",
          tone: "error",
          message: "No pude hablar con el servidor. Revisa tu conexion y vuelve a intentar."
        });
        setActivityState("idle");
      }
    });
  }

  function handleDownload() {
    if (!downloadHref) {
      return;
    }

    setActivityState("downloading");

    const link = document.createElement("a");
    link.href = downloadHref;
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();

    if (downloadResetTimeoutRef.current !== null) {
      window.clearTimeout(downloadResetTimeoutRef.current);
    }

    downloadResetTimeoutRef.current = window.setTimeout(() => {
      setActivityState("idle");
      downloadResetTimeoutRef.current = null;
    }, 2600);
  }

  function fillFromHistory(entry: DownloadHistoryEntry) {
    setUrl(entry.sourceUrl);
  }

  const downloadHref =
    currentVariant && screenState.status === "ready"
      ? `/api/download?url=${encodeURIComponent(currentVariant.downloadUrl)}&filename=${encodeURIComponent(buildFilename(screenState.media))}`
      : undefined;
  const previewVideoHref =
    currentVariant && screenState.status === "ready"
      ? `/api/media?url=${encodeURIComponent(currentVariant.downloadUrl)}`
      : undefined;
  const activityMessage =
    activityState === "analyzing"
      ? "Obteniendo la informacion del video..."
      : activityState === "downloading"
        ? "Preparando la descarga..."
        : null;

  useEffect(() => {
    if (!previewVideoHref || !currentVariant) {
      setPosterState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setPosterState({ status: "loading" });

    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = previewVideoHref;

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const fail = () => {
      if (!cancelled) {
        setPosterState({ status: "error" });
      }
      cleanup();
    };

    const capture = () => {
      if (cancelled) {
        cleanup();
        return;
      }

      const width = video.videoWidth || currentVariant.width || 640;
      const height = video.videoHeight || currentVariant.height || 360;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        fail();
        return;
      }

      context.drawImage(video, 0, 0, width, height);
      setPosterState({ status: "ready", dataUrl: canvas.toDataURL("image/jpeg", 0.82) });
      cleanup();
    };

    const handleLoadedData = () => {
      const previewTime = Math.min(1, Math.max(0.15, (video.duration || 1) * 0.12));

      if (Number.isFinite(previewTime)) {
        video.currentTime = previewTime;
      } else {
        capture();
      }
    };

    video.addEventListener("loadeddata", handleLoadedData, { once: true });
    video.addEventListener("seeked", capture, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.load();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [currentVariant, previewVideoHref]);

  return (
    <main className="shell">
      {activityMessage ? (
        <div className="activity-banner" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>{activityMessage}</span>
        </div>
      ) : null}

      <section className="hero">
        <span className="eyebrow">Descarga rapida</span>
        <h1 className="title">Descarga videos publicos de Instagram de forma simple.</h1>
        <p className="header-byline" aria-label="by tavo.hgo">
          <span className="header-byline-text">by tavo.hgo</span>
        </p>
        <p className="lead">
          Pega la liga de un reel o post publico. Antes de descargar, te mostramos la calidad, la resolucion,
          la duracion y el tamaño aproximado para que sepas exactamente que vas a bajar.
        </p>

        <div className="hero-grid">
          <div className="card pad">
            <p className="kicker">Paso 1</p>
            <h2 className="section-title">Pega la liga y revisa el video</h2>
            <p className="section-copy">
              Si el enlace es publico y compatible, veras una vista previa con la informacion mas importante antes
              de descargar.
            </p>

            <form className="form" onSubmit={handleAnalyze}>
              <label className="label" htmlFor="url">
                Liga de Instagram
                <input
                  id="url"
                  className="input"
                  type="url"
                  inputMode="url"
                  placeholder="https://www.instagram.com/reel/..."
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  required
                />
              </label>

              <div className="actions">
                <button className="button" type="submit" disabled={isPending || activityState === "downloading"}>
                  {isPending ? "Revisando..." : "Ver video"}
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    setUrl("");
                    setScreenState({ status: "idle" });
                  }}
                  disabled={isPending || activityState === "downloading"}
                >
                  Limpiar
                </button>
              </div>

              <p className="inline-note">
                Funciona mejor con reels y publicaciones publicas que tengan video.
              </p>

              {screenState.status === "error" ? (
                <p className="status-text" data-tone={screenState.tone}>
                  {screenState.message}
                </p>
              ) : null}
              {screenState.status === "loading" ? (
                <p className="status-text">Estamos preparando la mejor version disponible del video.</p>
              ) : null}
            </form>
          </div>

          <aside className="card pad">
            <p className="kicker">Antes de descargar</p>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Archivo</span>
                <span className="stat-value">Tipo de video</span>
              </div>
              <div className="stat">
                <span className="stat-label">Resolucion</span>
                <span className="stat-value">Tamano de imagen</span>
              </div>
              <div className="stat">
                <span className="stat-label">Calidad</span>
                <span className="stat-value">Basica, buena o alta</span>
              </div>
              <div className="stat">
                <span className="stat-label">Tamano</span>
                <span className="stat-value">Aproximado antes de bajar</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="content-grid">
        <article className="card pad preview">
          <div>
            <p className="kicker">Vista previa</p>
            <h2 className="section-title">Esto es lo que vas a descargar</h2>
          </div>

          <div className="media-thumb">
            {posterState.status === "ready" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={posterState.dataUrl} alt={screenState.status === "ready" ? screenState.media.title ?? "Preview del video" : "Preview del video"} />
            ) : screenState.status === "ready" && currentVariant ? (
              <div className="preview-poster">
                <span className="preview-chip">{formatQualityLabel(currentVariant.qualityLabel)}</span>
                <strong>{formatResolution(currentVariant.width, currentVariant.height)}</strong>
                <p>
                  {posterState.status === "loading"
                    ? "Preparando una miniatura del video."
                    : "No se pudo mostrar la miniatura, pero la descarga sigue disponible."}
                </p>
              </div>
            ) : (
              <div className="empty-illustration">Pega una liga para ver la calidad, la duracion y la descarga disponible.</div>
            )}
          </div>

          {screenState.status === "ready" && currentVariant ? (
            <>
              <div>
                <h3 className="section-title" style={{ marginBottom: 8 }}>
                  {screenState.media.title ?? "Video de Instagram"}
                </h3>
                {screenState.media.creatorHandle || screenState.media.creatorName ? (
                  <p className="creator-byline">
                    Por {screenState.media.creatorHandle ? `@${screenState.media.creatorHandle}` : screenState.media.creatorName}
                  </p>
                ) : null}
                <p className="section-copy" style={{ marginBottom: 0 }}>
                  Enlace original: {screenState.media.canonicalUrl}
                </p>
              </div>

              <div className="badges">
                <span className="badge" data-tone="warm">
                  {formatQualityLabel(currentVariant.qualityLabel)}
                </span>
                <span className="badge" data-tone="cool">
                  {currentVariant.container.toUpperCase()}
                </span>
                <span className="badge">Listo para descargar</span>
              </div>

              <dl className="metadata-grid">
                <div className="metadata-item">
                  <dt>Resolucion</dt>
                  <dd>{formatResolution(currentVariant.width, currentVariant.height)}</dd>
                </div>
                <div className="metadata-item">
                  <dt>Duracion</dt>
                  <dd>{formatDuration(screenState.media.durationMs)}</dd>
                </div>
                <div className="metadata-item">
                  <dt>Tamano aprox.</dt>
                  <dd>{formatBytes(currentVariant.fileSizeBytesEstimate)}</dd>
                </div>
                <div className="metadata-item">
                  <dt>Origen</dt>
                  <dd>Instagram</dd>
                </div>
              </dl>

              <div className="actions">
                <button className="button" type="button" onClick={handleDownload} disabled={activityState !== "idle"}>
                  {activityState === "downloading" ? "Preparando descarga..." : "Descargar mejor calidad"}
                </button>
                <a className="button-secondary" href={screenState.media.canonicalUrl} target="_blank" rel="noreferrer">
                  Abrir publicacion
                </a>
              </div>
            </>
          ) : (
            <p className="section-copy" style={{ marginBottom: 0 }}>
              Cuando pegues una liga valida, aqui veras la informacion basica del video antes de descargarlo.
            </p>
          )}
        </article>

        <aside className="card pad">
          <p className="kicker">Historial local</p>
          <h2 className="section-title">Enlaces recientes en este navegador</h2>
          <p className="section-copy">
            Guardamos un resumen sencillo para que puedas volver rapido a un video que ya revisaste.
          </p>

          {history.length > 0 ? (
            <ul className="history-list">
              {history.map((entry) => (
                <li key={entry.id} className="history-entry">
                  <button type="button" onClick={() => fillFromHistory(entry)}>
                    <strong>{entry.title ?? "Instagram video"}</strong>
                  </button>
                  <span className="history-url">{entry.sourceUrl}</span>
                  <div className="history-meta">
                    <span>{formatQualityLabel(entry.qualityLabel)}</span>
                    <span>{entry.resolution}</span>
                    <span>{entry.fileSizeLabel}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="inline-note">Todavia no hay analisis guardados en este navegador.</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function readHistory(): DownloadHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as DownloadHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(media: ResolvedMedia): DownloadHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  const bestVariant = pickBestVariant(media.variants);
  if (!bestVariant) {
    return readHistory();
  }

  const nextEntry: DownloadHistoryEntry = {
    id: `${media.canonicalUrl}:${bestVariant.id}`,
    addedAt: new Date().toISOString(),
    sourceUrl: media.sourceUrl,
    canonicalUrl: media.canonicalUrl,
    title: media.title,
    creatorName: media.creatorName,
    creatorHandle: media.creatorHandle,
    thumbnailUrl: media.thumbnailUrl,
    qualityLabel: bestVariant.qualityLabel,
    mimeType: bestVariant.mimeType,
    container: bestVariant.container,
    resolution: formatResolution(bestVariant.width, bestVariant.height),
    fileSizeLabel: formatBytes(bestVariant.fileSizeBytesEstimate)
  };

  const merged = [nextEntry, ...readHistory().filter((entry) => entry.id !== nextEntry.id)].slice(0, HISTORY_LIMIT);
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

function buildFilename(media: ResolvedMedia): string {
  const titlePart = (media.title ?? "instagram-video").slice(0, 64);
  return `${titlePart.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "instagram-video"}.mp4`;
}

function formatQualityLabel(label: "SD" | "HD" | "FULL_HD" | "UNKNOWN"): string {
  switch (label) {
    case "SD":
      return "Calidad basica";
    case "HD":
      return "Buena calidad";
    case "FULL_HD":
      return "Alta calidad";
    default:
      return "Calidad disponible";
  }
}
