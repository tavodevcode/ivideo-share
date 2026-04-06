import { analyzeInstagramUrl } from "@/lib/instagram/resolver";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const rawUrl = typeof body.url === "string" ? body.url : "";
    const result = await analyzeInstagramUrl(rawUrl);

    const status =
      result.kind === "success"
        ? 200
        : result.kind === "invalid_url"
          ? 400
          : result.kind === "unsupported"
            ? 422
            : 502;

    return Response.json(result, {
      status,
      headers: {
        "cache-control": "no-store"
      }
    });
  } catch {
    return Response.json(
      {
        kind: "network_error",
        message: "No pude procesar la solicitud."
      },
      {
        status: 500
      }
    );
  }
}
