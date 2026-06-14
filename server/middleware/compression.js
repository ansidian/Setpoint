import zlib from "zlib";

// Below this size gzip's framing overhead and CPU cost outweigh the byte savings.
const DEFAULT_THRESHOLD = 1024;

// Content types that compress well. Text and structured payloads (JSON/XML/SVG/
// JS/CSS) are worth gzipping; images, audio, video, fonts and wasm are already
// compressed or binary, so they are skipped. text/event-stream is deliberately
// excluded so SSE responses (Alfred + dashboard event streams) are never buffered.
const COMPRESSIBLE_TYPE =
  /^(?:text\/(?!event-stream)|application\/(?:json|javascript|x-javascript|manifest\+json|xml|[\w.+-]+\+json|[\w.+-]+\+xml)|image\/svg\+xml)/i;

function clientAcceptsGzip(req) {
  const header = String(req.headers["accept-encoding"] || "");
  if (!header) return false;
  // Match "gzip" with an optional q-value; treat q=0 as an explicit refusal.
  const match = header.match(/(?:^|,)\s*gzip\s*(?:;\s*q\s*=\s*([0-9.]+))?/i);
  if (!match) return false;
  if (match[1] !== undefined && Number.parseFloat(match[1]) === 0) return false;
  return true;
}

function appendVaryAcceptEncoding(res) {
  const existing = res.getHeader("Vary");
  if (!existing) {
    res.setHeader("Vary", "Accept-Encoding");
  } else if (!/\bAccept-Encoding\b/i.test(String(existing))) {
    res.setHeader("Vary", `${existing}, Accept-Encoding`);
  }
}

/**
 * Streaming-safe gzip middleware built on the built-in zlib (no dependency).
 *
 * It buffers a compressible response, gzips it, and rewrites Content-Encoding/
 * Content-Length/Vary. The decision happens on the FIRST write/end — once the
 * route has set Content-Type — so non-compressible responses (images, SSE,
 * already-encoded, range/partial, no-transform) immediately restore the native
 * write/end and stream through untouched. This is what keeps text/event-stream
 * responses (Alfred, dashboard events) from being buffered.
 */
export function responseCompression({ threshold = DEFAULT_THRESHOLD } = {}) {
  return function compress(req, res, next) {
    if (req.method === "HEAD" || !clientAcceptsGzip(req)) return next();

    const originalWrite = res.write;
    const originalEnd = res.end;
    const chunks = [];
    let bufferedLength = 0;
    let mode = null; // null = undecided, "buffer" = gzip, "passthrough" = native

    function restoreNative() {
      res.write = originalWrite;
      res.end = originalEnd;
    }

    function decide() {
      if (mode !== null) return mode;
      // Headers are set by the route by the time the first write/end fires.
      if (res.statusCode === 206 || res.getHeader("Content-Range")) return (mode = "passthrough");
      if (res.getHeader("Content-Encoding")) return (mode = "passthrough");
      if (/\bno-transform\b/i.test(String(res.getHeader("Cache-Control") || ""))) return (mode = "passthrough");
      const type = String(res.getHeader("Content-Type") || "");
      return (mode = COMPRESSIBLE_TYPE.test(type) ? "buffer" : "passthrough");
    }

    function toBuffer(chunk, encoding) {
      if (chunk == null) return null;
      if (Buffer.isBuffer(chunk)) return chunk;
      return Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8");
    }

    res.write = function patchedWrite(chunk, encoding, callback) {
      if (decide() === "passthrough") {
        restoreNative();
        return originalWrite.call(res, chunk, encoding, callback);
      }
      const buf = toBuffer(chunk, encoding);
      if (buf) {
        chunks.push(buf);
        bufferedLength += buf.length;
      }
      if (typeof encoding === "function") encoding();
      else if (typeof callback === "function") callback();
      return true;
    };

    res.end = function patchedEnd(chunk, encoding, callback) {
      if (typeof chunk === "function") {
        callback = chunk;
        chunk = undefined;
        encoding = undefined;
      } else if (typeof encoding === "function") {
        callback = encoding;
        encoding = undefined;
      }

      if (decide() === "passthrough") {
        restoreNative();
        return originalEnd.call(res, chunk, encoding, callback);
      }

      const tail = toBuffer(chunk, encoding);
      if (tail) {
        chunks.push(tail);
        bufferedLength += tail.length;
      }
      const body = bufferedLength ? Buffer.concat(chunks, bufferedLength) : Buffer.alloc(0);
      restoreNative();

      if (body.length < threshold) {
        return originalEnd.call(res, body, callback);
      }

      zlib.gzip(body, (err, compressed) => {
        if (err) {
          // Compression failed — fall back to the uncompressed body.
          return originalEnd.call(res, body, callback);
        }
        res.setHeader("Content-Encoding", "gzip");
        res.removeHeader("Content-Length");
        res.setHeader("Content-Length", String(compressed.length));
        appendVaryAcceptEncoding(res);
        originalEnd.call(res, compressed, callback);
      });
      return res;
    };

    next();
  };
}
