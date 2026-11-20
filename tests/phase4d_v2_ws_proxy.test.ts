import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. vite.config.ts proxies both /api and /ws (ws: true) to the backend", () => {
  const src = read("vite.config.ts");
  assert.match(src, /['"]\/api['"]\s*:\s*\{[\s\S]*?target:\s*env\.VITE_BACKEND_PROXY_URL\s*\|\|\s*['"]http:\/\/127\.0\.0\.1:5000['"]/);
  assert.match(src, /['"]\/ws['"]\s*:\s*\{[\s\S]*?target:\s*env\.VITE_BACKEND_PROXY_URL\s*\|\|\s*['"]http:\/\/127\.0\.0\.1:5000['"][\s\S]*?ws:\s*true/);
});

test("2. useAcademyWS connects via /ws/academy/ on window.location.host and cleans up with code 1000", () => {
  const src = read("hooks/useAcademyWS.ts");
  assert.equal(src.includes("/ws/academy/"), true);
  assert.equal(src.includes("?token="), true);
  assert.equal(src.includes("window.location.host"), true);
  assert.equal(src.includes("export function disconnectAcademyWS"), true);
  assert.equal(src.includes("1000"), true);
});

test("3. Backend ASGI routing exposes ws/academy/ via AcademyConsumer", () => {
  const routing = read("backend/academy/routing.py");
  const asgi = read("backend/config/asgi.py");
  assert.equal(routing.includes("ws/academy/"), true);
  assert.equal(routing.includes("AcademyConsumer"), true);
  assert.equal(asgi.includes("JWTAuthMiddleware"), true);
  assert.equal(asgi.includes("ProtocolTypeRouter"), true);
});
