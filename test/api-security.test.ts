import test from "node:test";
import assert from "node:assert/strict";
import { isApiRequestAuthorized } from "../src/api/server";

const allowedOrigins = ["http://127.0.0.1:5173", "http://tauri.localhost"];

test("configured API token protects read endpoints", () => {
  const unauthenticated = isApiRequestAuthorized("GET", undefined, undefined, "review-token", allowedOrigins);
  const wrongLength = isApiRequestAuthorized("GET", undefined, "review", "review-token", allowedOrigins);
  const authenticated = isApiRequestAuthorized("GET", undefined, "review-token", "review-token", allowedOrigins);

  assert.equal(unauthenticated.authorized, false);
  assert.equal(unauthenticated.status, 401);
  assert.equal(wrongLength.authorized, false);
  assert.equal(wrongLength.status, 401);
  assert.equal(authenticated.authorized, true);
});

test("unconfigured API token does not authorize protected requests", () => {
  const result = isApiRequestAuthorized("GET", undefined, undefined, null, allowedOrigins);

  assert.equal(result.authorized, false);
  assert.equal(result.status, 401);
});

test("API origin allowlist applies before token checks", () => {
  const result = isApiRequestAuthorized(
    "POST",
    "http://evil.localhost",
    "review-token",
    "review-token",
    allowedOrigins,
  );

  assert.equal(result.authorized, false);
  assert.equal(result.status, 403);
});
