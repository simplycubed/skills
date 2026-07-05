// skills-cdn — serves the content-addressed skill snapshot store from R2.
//
// Public, read-only surface at cdn.simplycubed.com. Objects are content-addressed
// (the <hex> in the path IS the integrity contract), so downloads STREAM straight
// through with immutable caching — no per-byte hashing on the hot path. Integrity
// re-hashing is opt-in (?verify=1) for CI/monitoring only, since it costs CPU
// proportional to object size.
export interface Env {
  BUCKET: R2Bucket;
  SLUGMAP?: KVNamespace; // fast-follow: slug -> hex | "revoked"
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const BLOB_RE = /^blobs\/sha256\/[0-9a-f]{64}\/unit\.tar\.gz$/;
const RECORD_RE = /^records\/sha256\/[0-9a-f]{64}\.json$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(req.url);
    const key = url.pathname.replace(/^\/+/, "");

    if (BLOB_RE.test(key) || RECORD_RE.test(key)) {
      const obj = await env.BUCKET.get(key);
      if (!obj) return new Response("not found", { status: 404 });

      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("Cache-Control", IMMUTABLE);
      headers.set("Content-Type", key.endsWith(".json") ? "application/json" : "application/gzip");
      // The content hash is the strong ETag.
      const hex = key.split("/")[2];
      if (hex) headers.set("ETag", `"sha256:${hex}"`);

      // Opt-in integrity verification (CI/monitoring only — CPU ∝ bytes, never default).
      if (url.searchParams.get("verify") === "1") {
        const bytes = new Uint8Array(await obj.arrayBuffer());
        // NOTE: this verifies the OBJECT bytes; the marketplace's authoritative
        // integrity is the re-hash of the EXTRACTED tree (done by snapshot-check).
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const got = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
        headers.set("X-Object-SHA256", got);
        return new Response(bytes, { headers });
      }
      return new Response(req.method === "HEAD" ? null : obj.body, { headers });
    }

    // fast-follow: /skills/<slug>/unit.tar.gz -> SLUGMAP lookup -> 302 or 410
    return new Response("not found", { status: 404 });
  },
};
