#!/usr/bin/env node
/**
 * Serveur static minimal pour storybook-static (capture VR).
 *
 * Pourquoi pas `npx serve` :
 * - cleanUrls:true → GET /iframe.html?id=… redirige vers /iframe (query stripée)
 * - cleanUrls:false → GET / affiche le directory listing au lieu de index.html
 *
 * Ici : `/` → index.html, fichiers servis tels quels (query string préservée).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const rootArg = process.argv[2];
const listenArg = process.argv[3] ?? "6006";

if (!rootArg) {
  console.error("Usage: vr-static-server.mjs <rootDir> [port|tcp://host:port]");
  process.exit(1);
}

const root = path.resolve(rootArg);

let host = "127.0.0.1";
let port = 6006;
if (listenArg.startsWith("tcp://")) {
  try {
    const u = new URL(listenArg);
    host = u.hostname || "0.0.0.0";
    port = Number(u.port) || 6006;
  } catch {
    console.error(`Invalid listen URI: ${listenArg}`);
    process.exit(1);
  }
} else {
  port = Number(listenArg) || 6006;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

/** Première story de index.json pour ouvrir Storybook déjà sélectionné. */
const resolveFirstStoryId = () => {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"));
    const entries = index.entries || {};
    for (const entry of Object.values(entries)) {
      if (entry && entry.type === "story" && typeof entry.id === "string") {
        return entry.id;
      }
    }
  } catch {
    // ignore missing/invalid index.json
  }
  return null;
};

/**
 * Injecte un replaceState synchrone AVANT les bundles Storybook.
 * Évite un 302 (double navigation → preview blanche jusqu’à F5).
 */
const maybeInjectFirstStoryBootstrap = (html, { injectFirstStory }) => {
  if (!injectFirstStory) return html;
  const storyId = resolveFirstStoryId();
  if (!storyId) return html;
  const bootstrap = `<script>(function(){try{var s=location.search||"";if(/[?&]path=/.test(s)||/[?&]id=/.test(s))return;var p="/?path=/story/${storyId}";history.replaceState(null,"",p);}catch(e){}})();</script>`;
  if (html.includes("<head>")) return html.replace("<head>", `<head>${bootstrap}`);
  if (html.includes("<HEAD>")) return html.replace("<HEAD>", `<HEAD>${bootstrap}`);
  return bootstrap + html;
};

const sendFile = (res, filePath, { injectFirstStory = false } = {}) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" && injectFirstStory) {
    let html = fs.readFileSync(filePath, "utf8");
    html = maybeInjectFirstStoryBootstrap(html, { injectFirstStory });
    const body = Buffer.from(html, "utf8");
    res.writeHead(200, {
      "Content-Type": MIME[".html"],
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
    });
    res.end(body);
    return;
  }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(filePath).pipe(res);
};

const server = http.createServer((req, res) => {
  try {
    const rawUrl = req.url || "/";
    const url = new URL(rawUrl, "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);

    const wantsRootIndex = pathname === "/" || pathname === "" || pathname === "/index.html";
    const needsFirstStoryInject = wantsRootIndex && !url.searchParams.has("path") && !url.searchParams.has("id");

    if (pathname === "/" || pathname === "") pathname = "/index.html";

    const resolved = path.resolve(path.join(root, pathname));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      send(res, 403, "Forbidden");
      return;
    }

    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      send(res, 404, "Not found");
      return;
    }

    if (stat.isDirectory()) {
      const indexPath = path.join(resolved, "index.html");
      try {
        const indexStat = fs.statSync(indexPath);
        if (indexStat.isFile()) {
          sendFile(res, indexPath, { injectFirstStory: needsFirstStoryInject && resolved === root });
          return;
        }
      } catch {
        // fallthrough
      }
      send(res, 404, "Not found");
      return;
    }

    if (!stat.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    sendFile(res, resolved, {
      injectFirstStory: needsFirstStoryInject && path.basename(resolved) === "index.html",
    });
  } catch (error) {
    console.error("[vr-static-server]", error);
    send(res, 500, "Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`[vr-static-server] Serving ${root} on http://${host}:${port}`);
});
