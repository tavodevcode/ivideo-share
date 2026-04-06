import { describe, expect, it, vi } from "vitest";
import { analyzeInstagramUrl, isAllowedDownloadUrl, normalizeInstagramUrl } from "@/lib/instagram/resolver";

describe("normalizeInstagramUrl", () => {
  it("normaliza un reel publico y remueve query params", () => {
    expect(normalizeInstagramUrl("https://www.instagram.com/reel/ABC123/?utm_source=ig_web_copy_link")).toBe(
      "https://www.instagram.com/reel/ABC123/"
    );
  });

  it("rechaza hosts o rutas no soportadas", () => {
    expect(normalizeInstagramUrl("https://example.com/video")).toBeNull();
    expect(normalizeInstagramUrl("https://www.instagram.com/stories/highlights/123")).toBeNull();
  });
});

describe("isAllowedDownloadUrl", () => {
  it("acepta hosts conocidos de media", () => {
    expect(isAllowedDownloadUrl("https://scontent.cdninstagram.com/o1/v/t16/f2/m86/sample.mp4")).toBe(true);
    expect(isAllowedDownloadUrl("https://video.xx.fbcdn.net/v/t42.3356-2/sample.mp4")).toBe(true);
  });

  it("rechaza urls arbitrarias", () => {
    expect(isAllowedDownloadUrl("https://evil.example.com/file.mp4")).toBe(false);
  });
});

describe("analyzeInstagramUrl", () => {
  it("devuelve invalid_url para entradas no soportadas", async () => {
    const result = await analyzeInstagramUrl("https://www.google.com");
    expect(result.kind).toBe("invalid_url");
  });

  it("extrae metadata publica desde un payload embebido", async () => {
    const html = `
      <html>
        <body>
          <script type="application/json">
            {
              "shortcode_media": {
                "video_url": "https:\\/\\/scontent.cdninstagram.com\\/v\\/t50.2886-16\\/sample.mp4",
                "display_url": "https:\\/\\/images.cdninstagram.com\\/thumb.jpg",
                "title": "Sunset ride",
                "video_duration": 12.4,
                "width": 1080,
                "height": 1920
              }
            }
          </script>
        </body>
      </html>
    `;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html"
        }
      })
    );

    const result = await analyzeInstagramUrl("https://www.instagram.com/reel/abc123/");
    fetchMock.mockRestore();

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected success result");
    }

    expect(result.media.title).toBe("Sunset ride");
    expect(result.media.variants[0]?.downloadUrl).toContain("scontent.cdninstagram.com");
    expect(result.media.variants[0]?.qualityLabel).toBe("FULL_HD");
    expect(result.media.durationMs).toBe(12400);
  });

  it("responde unsupported cuando no hay video publico", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("<html><body><script type=\"application/json\">{\"title\":\"No video\"}</script></body></html>", {
          status: 200,
          headers: {
            "content-type": "text/html"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response("<html><body><script type=\"application/json\">{\"title\":\"Still no video\"}</script></body></html>", {
          status: 200,
          headers: {
            "content-type": "text/html"
          }
        })
      );

    const result = await analyzeInstagramUrl("https://www.instagram.com/p/abc123/");
    fetchMock.mockRestore();

    expect(result.kind).toBe("unsupported");
  });

  it("usa el fallback embed cuando la pagina principal no expone video_url", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("<html><head><meta property=\"og:title\" content=\"Only image\" /></head><body></body></html>", {
          status: 200,
          headers: {
            "content-type": "text/html"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          `<html><body><script>requireLazy(["TimeSliceImpl","ServerJS"],function(TimeSlice,ServerJS){(new ServerJS()).handle({"instances":[["X",[],[0,"{\\"gql_data\\":{\\"shortcode_media\\":{\\"video_url\\":\\"https:\\\\\\/\\\\\\/scontent.cdninstagram.com\\\\/v\\\\/sample.mp4\\",\\"display_url\\":\\"https:\\\\\\/\\\\\\/images.cdninstagram.com\\\\/thumb.jpg\\",\\"dimensions\\":{\\"width\\":640,\\"height\\":1136},\\"owner\\":{\\"username\\":\\"creator_demo\\"},\\"taken_at_timestamp\\":1775487091}}}"]]]})});</script></body></html>`,
          {
            status: 200,
            headers: {
              "content-type": "text/html"
            }
          }
        )
      );

    const result = await analyzeInstagramUrl("https://www.instagram.com/reel/fallback123/");
    fetchMock.mockRestore();

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected success result");
    }

    expect(result.media.variants[0]?.downloadUrl).toBe("https://scontent.cdninstagram.com/v/sample.mp4");
    expect(result.media.variants[0]?.qualityLabel).toBe("HD");
    expect(result.media.variants[0]?.width).toBe(640);
    expect(result.media.variants[0]?.height).toBe(1136);
    expect(result.media.thumbnailUrl).toBe("https://images.cdninstagram.com/thumb.jpg");
    expect(result.media.creatorHandle).toBe("creator_demo");
  });
});
