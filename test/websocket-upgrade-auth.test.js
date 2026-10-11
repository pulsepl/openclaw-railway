import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const idx = src.indexOf('server.on("upgrade"');
const upgradeWindow = src.slice(idx, idx + 1600);

test("ws upgrade handler exists", () => {
  assert.ok(idx >= 0);
});

test("ws upgrade requires the dashboard session cookie or a valid password", () => {
  // The wrapper injects the gateway token into proxied upgrades, so an unauthenticated
  // upgrade must never reach proxy.ws().
  assert.match(upgradeWindow, /hasValidSessionCookie\(req\)/);
  assert.match(upgradeWindow, /checkBasicPassword\(req\)/);
  const authAt = upgradeWindow.indexOf("hasValidSessionCookie(req)");
  const proxyAt = upgradeWindow.indexOf("proxy.ws(");
  assert.ok(authAt >= 0 && proxyAt > authAt, "auth check must run before proxy.ws");
});

test("ws upgrade does not send a Basic auth challenge (issue #162: browsers can't answer it)", () => {
  assert.doesNotMatch(upgradeWindow, /WWW-Authenticate/);
});

test("password comparison is constant-time and rate limited", () => {
  assert.match(src, /crypto\.timingSafeEqual/);
  assert.match(src, /function isAuthLockedOut\(/);
  assert.doesNotMatch(src, /password !== SETUP_PASSWORD/);
});

test("public /healthz does not expose paths or gateway errors", () => {
  const h = src.indexOf('app.get("/healthz"');
  const body = src.slice(h, h + 900);
  assert.doesNotMatch(body, /stateDir|workspaceDir|lastGatewayError|GATEWAY_TARGET/);
});
