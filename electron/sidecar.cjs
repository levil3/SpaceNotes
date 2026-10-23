const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const SESSION_COOKIE = "spacenotes_session";
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function createEventBroadcaster() {
  const subscribers = new Set();

  return {
    subscribe(response) {
      subscribers.add(response);
      return () => subscribers.delete(response);
    },
    broadcast(payload) {
      const message = `event: vault-changed\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const response of subscribers) {
        response.write(message);
      }
    },
    close() {
      for (const response of subscribers) {
        response.end();
      }
      subscribers.clear();
    },
  };
}

function parseCookies(request) {
  const values = {};
  for (const entry of String(request.headers.cookie || "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (name) {
      values[name] = value;
    }
  }
  return values;
}

function tokenMatches(expected, presented) {
  if (typeof presented !== "string" || !presented) {
    return false;
  }
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return (
    expectedBytes.length === presentedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, presentedBytes)
  );
}

function requestToken(request, url) {
  const authorization = String(request.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  const cookies = parseCookies(request);
  return cookies[SESSION_COOKIE] || url.searchParams.get("token") || "";
}

function responseHeaders(request, allowedOrigins) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers.Vary = "Origin";
  }
  return headers;
}

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendText(response, status, value, headers = {}) {
  response.writeHead(status, {
    ...headers,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
  });
  response.end(value);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("请求内容过大。");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求格式无效。");
  }
}

function safeWebPath(webRoot, requestPath) {
  const root = path.resolve(webRoot);
  let decoded = "";
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function createSidecarServer({
  api,
  vaultService,
  webRoot,
  token,
  allowedOrigins = [],
  internalHandlers = {},
  broadcaster = createEventBroadcaster(),
  logger = () => {},
}) {
  if (!token || typeof token !== "string") {
    throw new Error("sidecar 必须配置启动令牌。");
  }
  const originSet = new Set(
    allowedOrigins.map((origin) => String(origin).toLowerCase()),
  );
  const server = http.createServer(async (request, response) => {
    const headers = responseHeaders(request, originSet);
    const localOrigin = `http://127.0.0.1:${request.socket.localPort}`;
    const origin = String(request.headers.origin || "").toLowerCase();

    if (
      origin &&
      origin !== localOrigin &&
      !originSet.has(origin)
    ) {
      sendText(response, 403, "来源不被允许。", headers);
      return;
    }
    if (
      request.headers.host !==
      `127.0.0.1:${request.socket.localPort}`
    ) {
      sendText(response, 403, "Host 不被允许。", headers);
      return;
    }

    const url = new URL(
      request.url || "/",
      `http://${request.headers.host}`,
    );

    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    if (
      url.pathname === "/" &&
      tokenMatches(token, url.searchParams.get("token") || "")
    ) {
      response.writeHead(302, {
        ...headers,
        Location: "/",
        "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
      response.end();
      return;
    }

    if (!tokenMatches(token, requestToken(request, url))) {
      sendJson(response, 401, { error: "未授权。" }, headers);
      return;
    }

    try {
      if (url.pathname === "/events" && request.method === "GET") {
        response.writeHead(200, {
          ...headers,
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
          "Cache-Control": "no-cache",
        });
        response.write("retry: 1000\n\n");
        const unsubscribe = broadcaster.subscribe(response);
        const heartbeat = setInterval(() => {
          response.write(": heartbeat\n\n");
        }, 15000);
        request.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      if (url.pathname === "/assets" && request.method === "GET") {
        const target = url.searchParams.get("target") || "";
        const notePath = url.searchParams.get("note") || "";
        try {
          const assetPath = await vaultService.resolveAsset(
            target,
            notePath,
          );
          const { content } = await vaultService.readResolvedFile(assetPath);
          response.writeHead(200, {
            ...headers,
            "Content-Type":
              CONTENT_TYPES.get(
                path.extname(assetPath).toLowerCase(),
              ) || "application/octet-stream",
            "Content-Length": content.length,
          });
          response.end(content);
        } catch (error) {
          logger("asset-not-found", error);
          sendText(response, 404, "附件不存在。", headers);
        }
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        if (request.method !== "POST") {
          sendJson(
            response,
            405,
            { error: "只支持 POST 请求。" },
            headers,
          );
          return;
        }
        const method = url.pathname.slice("/api/".length);
        if (
          !Object.prototype.hasOwnProperty.call(api, method) ||
          typeof api[method] !== "function"
        ) {
          sendJson(
            response,
            404,
            { error: "未知 API 方法。" },
            headers,
          );
          return;
        }
        let body;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          sendJson(
            response,
            400,
            { error: error.message || "请求格式无效。" },
            headers,
          );
          return;
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendJson(
            response,
            400,
            { error: "请求体必须是对象。" },
            headers,
          );
          return;
        }
        const args = Array.isArray(body.args) ? body.args : [];
        try {
          const result = await api[method](...args);
          sendJson(response, 200, { result }, headers);
        } catch (error) {
          logger("api-error", method, error);
          sendJson(
            response,
            400,
            {
              error:
                error instanceof Error && error.message
                  ? error.message
                  : "请求失败。",
            },
            headers,
          );
        }
        return;
      }

      if (url.pathname.startsWith("/internal/")) {
        if (request.method !== "POST") {
          sendJson(
            response,
            405,
            { error: "只支持 POST 请求。" },
            headers,
          );
          return;
        }
        const method = url.pathname.slice("/internal/".length);
        if (
          !Object.prototype.hasOwnProperty.call(internalHandlers, method) ||
          typeof internalHandlers[method] !== "function"
        ) {
          sendJson(
            response,
            404,
            { error: "未知宿主方法。" },
            headers,
          );
          return;
        }
        let body;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          sendJson(
            response,
            400,
            { error: error.message || "请求格式无效。" },
            headers,
          );
          return;
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendJson(
            response,
            400,
            { error: "请求体必须是对象。" },
            headers,
          );
          return;
        }
        const args = Array.isArray(body.args) ? body.args : [];
        try {
          const result = await internalHandlers[method](...args);
          sendJson(response, 200, { result }, headers);
        } catch (error) {
          logger("internal-error", method, error);
          sendJson(
            response,
            400,
            {
              error:
                error instanceof Error && error.message
                  ? error.message
                  : "宿主请求失败。",
            },
            headers,
          );
        }
        return;
      }

      if (request.method !== "GET") {
        sendText(response, 405, "Method Not Allowed", headers);
        return;
      }

      const filePath = safeWebPath(webRoot, url.pathname);
      if (!filePath) {
        sendText(response, 404, "Not Found", headers);
        return;
      }
      try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) {
          throw new Error("not a file");
        }
        response.writeHead(200, {
          ...headers,
          "Content-Type":
            CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ||
            "application/octet-stream",
          "Content-Length": stat.size,
        });
        fs.createReadStream(filePath).pipe(response);
      } catch {
        sendText(response, 404, "Not Found", headers);
      }
    } catch (error) {
      logger("request-error", error);
      if (!response.headersSent) {
        sendJson(
          response,
          500,
          { error: "sidecar 请求失败。" },
          headers,
        );
      } else {
        response.end();
      }
    }
  });

  return {
    server,
    broadcaster,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      broadcaster.close();
      if (!server.listening) {
        return;
      }
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections();
      server.closeAllConnections();
      await closed;
    },
  };
}

module.exports = {
  SESSION_COOKIE,
  createEventBroadcaster,
  createSidecarServer,
  safeWebPath,
};
