import test from "node:test";
import assert from "node:assert/strict";
import { isApiRequestAuthorized } from "../src/api/server";

const allowedOrigins = ["http://127.0.0.1:5173", "http://tauri.localhost"];

test("configured API token protects read endpoints", () => {
  const unauthenticated = isApiRequestAuthorized("GET", undefined, undefined, "review-token", allowedOrigins);
  const authenticated = isApiRequestAuthorized("GET", undefined, "review-token", "review-token", allowedOrigins);

  assert.equal(unauthenticated.authorized, false);
  assert.equal(unauthenticated.status, 401);
  assert.equal(authenticated.authorized, true);
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
