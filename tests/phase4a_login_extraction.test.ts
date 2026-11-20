import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. LoginScreen owns login form state, remember-me key, and loginToDjango call", () => {
  const src = read("components/LoginScreen.tsx");
  assert.equal(src.includes('export const REMEMBERED_LOGIN_KEY = "ivs_remembered_username"'), true);
  assert.equal(src.includes("loginToDjango(username, password)"), true);
  assert.equal(src.includes("onLoginSuccess(nextSession)"), true);
  assert.equal(src.includes("ivs-login-card"), true);
  assert.equal(src.includes("../App"), false, "LoginScreen must not introduce a circular import to App.tsx");
});

test("2. App.tsx delegates unauthenticated rendering to LoginScreen without duplicate login code", () => {
  const appSrc = read("App.tsx");
  assert.equal(appSrc.includes('import LoginScreen from "./components/LoginScreen"'), true);
  assert.equal(appSrc.includes("<LoginScreen onLoginSuccess={handleLoginSuccess} />"), true);
  assert.equal(appSrc.includes("loginToDjango"), false, "App.tsx must not retain unused loginToDjango import/calls");
  assert.equal(appSrc.includes("REMEMBERED_LOGIN_KEY"), false, "App.tsx must not duplicate REMEMBERED_LOGIN_KEY");
  assert.equal(appSrc.includes("ivs-login-card"), false, "App.tsx must not retain duplicate login JSX/CSS");
  assert.equal(appSrc.includes("saveSession(nextSession)"), true);
  assert.equal(appSrc.includes("connectAcademyWS()"), true);
  assert.equal(appSrc.includes('navigateToTab("platform-admin")'), true);
  assert.equal(appSrc.includes('navigateToTab("dashboard")'), true);
});
