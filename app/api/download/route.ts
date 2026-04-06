import { isAllowedDownloadUrl } from "@/lib/instagram/resolver";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");
  const rawFilename = searchParams.get("filename") ?? "instagram-video.mp4";

  if (!rawUrl || !isAllowedDownloadUrl(rawUrl)) {
    return new Response("Download URL no permitida.", { status: 400 });
  }

  const upstream = await fetch(rawUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    },
    redirect: "follow",
    cache: "no-store"
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("No se pudo descargar el video.", { status: 502 });
  }

  const filename = sanitizeFilename(rawFilename);
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "video/mp4");
  headers.set("content-disposition", `attachment; filename="${filename}"`);

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("content-length", contentLength);
  }

  return new Response(upstream.body, {
    status: 200,
    headers
  });
}

function sanitizeFilename(filename: string): string {
  const clean = filename.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-");
  return clean.toLowerCase().endsWith(".mp4") ? clean : `${clean}.mp4`;
}
