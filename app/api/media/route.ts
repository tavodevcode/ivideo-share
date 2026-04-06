import { isAllowedDownloadUrl } from "@/lib/instagram/resolver";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  if (!rawUrl || !isAllowedDownloadUrl(rawUrl)) {
    return new Response("Media URL no permitida.", { status: 400 });
  }

  const upstreamHeaders = new Headers({
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  });
  const range = request.headers.get("range");

  if (range) {
    upstreamHeaders.set("range", range);
  }

  const upstream = await fetch(rawUrl, {
    headers: upstreamHeaders,
    redirect: "follow",
    cache: "no-store"
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("No se pudo cargar el video para preview.", { status: 502 });
  }

  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "video/mp4");
  headers.set("cache-control", "private, max-age=60");

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("content-length", contentLength);
  }

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) {
    headers.set("content-range", contentRange);
  }

  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) {
    headers.set("accept-ranges", acceptRanges);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}
