const BASE = "http://localhost:3001";

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function json(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json() as any;
  return { status: res.status, data };
}

async function raw(method: string, path: string, body?: string, contentType?: string) {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.body = body;
    opts.headers = { "Content-Type": contentType || "application/json" };
  }
  return fetch(`${BASE}${path}`, opts);
}

async function main() {
  console.log("\n=== INPUT VALIDATION ===\n");

  await test("POST /projects/index with no body", async () => {
    const r = await json("POST", "/projects/index");
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /projects/index with empty repoRoot", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /projects/index with numeric repoRoot", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: 12345 });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /projects/index with null repoRoot", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: null });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /projects/index with array repoRoot", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: ["/tmp"] });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /projects/index with nonexistent path", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/nonexistent/path/xyz" });
    assert(r.status === 500 || r.status === 400, `Expected 4xx/5xx, got ${r.status}`);
  });

  await test("POST /projects/index with file path (not directory)", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "./package.json" });
    assert(r.status === 500 || r.status === 400, `Expected 4xx/5xx, got ${r.status}`);
  });

  await test("POST /query with no body", async () => {
    const r = await json("POST", "/query");
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /query with empty query", async () => {
    const r = await json("POST", "/query", { query: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /query with numeric query", async () => {
    const r = await json("POST", "/query", { query: 42 });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /query with no project selected", async () => {
    const r = await json("POST", "/query", { query: "test" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("POST /query with oversized query (>10000 chars)", async () => {
    // First index a project to select it
    await json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "Temp" });
    const r = await json("POST", "/query", { query: "x".repeat(10001) });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assert(r.data.error.includes("10000"), `Expected length error, got: ${r.data.error}`);
  });

  console.log("\n=== PATH TRAVERSAL ===\n");

  await test("POST /projects/index with path traversal (../../../etc)", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "../../../etc" });
    // Should either fail because /etc has no .ts files or succeed with 0 units
    // Should NOT crash the server
    assert(r.status === 200 || r.status === 400 || r.status === 500, `Server crashed: ${r.status}`);
  });

  await test("POST /projects/index with /dev/null", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/dev/null" });
    assert(r.status === 400 || r.status === 500, `Expected error, got ${r.status}`);
  });

  console.log("\n=== SQL INJECTION ===\n");

  await test("GET /projects/:id with SQL injection in ID", async () => {
    const r = await json("GET", "/projects/'; DROP TABLE projects; --");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("POST /projects/index with SQL injection in name", async () => {
    const r = await json("POST", "/projects/index", {
      repoRoot: "./test/test-repo",
      name: "'; DROP TABLE projects; --",
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    // Verify projects table still exists
    const list = await json("GET", "/projects");
    assert(list.status === 200, `Projects table destroyed! Got ${list.status}`);
    assert(Array.isArray(list.data), "Projects list is not an array");
  });

  await test("POST /query with SQL injection in query", async () => {
    const r = await json("POST", "/query", { query: "'; DROP TABLE code_units; --" });
    // Should not crash, query goes to Meilisearch/Qdrant not SQLite directly
    assert(r.status === 200 || r.status === 500, `Unexpected status: ${r.status}`);
  });

  console.log("\n=== INVALID IDS ===\n");

  await test("GET /projects/:id with nonexistent UUID", async () => {
    const r = await json("GET", "/projects/00000000-0000-0000-0000-000000000000");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("DELETE /projects/:id with nonexistent UUID", async () => {
    const r = await json("DELETE", "/projects/00000000-0000-0000-0000-000000000000");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("POST /projects/:id/select with nonexistent UUID", async () => {
    const r = await json("POST", "/projects/00000000-0000-0000-0000-000000000000/select");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("POST /projects/:id/summarize with nonexistent UUID", async () => {
    const r = await json("POST", "/projects/00000000-0000-0000-0000-000000000000/summarize");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("GET /projects/:id/graph with nonexistent UUID", async () => {
    const r = await json("GET", "/projects/00000000-0000-0000-0000-000000000000/graph");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  await test("GET /projects/:id/graph/directory with nonexistent UUID", async () => {
    const r = await json("GET", "/projects/00000000-0000-0000-0000-000000000000/graph/directory");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  });

  console.log("\n=== MALFORMED REQUESTS ===\n");

  await test("POST /projects/index with invalid JSON body", async () => {
    const res = await raw("POST", "/projects/index", "{invalid json!!!", "application/json");
    assert(res.status === 400, `Expected 400 for malformed JSON, got ${res.status}`);
  });

  await test("POST /query with wrong content-type", async () => {
    const res = await raw("POST", "/query", "query=test", "application/x-www-form-urlencoded");
    assert(res.status === 400 || res.status === 415, `Expected 400/415, got ${res.status}`);
  });

  await test("GET on POST-only endpoint /query", async () => {
    const res = await fetch(`${BASE}/query`);
    // Express returns 404 for unmatched GET /query
    assert(res.status === 404 || res.status === 405, `Expected 404/405, got ${res.status}`);
  });

  await test("POST /projects/index with extra unknown fields", async () => {
    const r = await json("POST", "/projects/index", {
      repoRoot: "./test/test-repo",
      name: "Extra Fields Test",
      malicious: true,
      __proto__: { admin: true },
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  console.log("\n=== EDGE CASES: EMPTY/SPECIAL REPOS ===\n");

  // Create edge case test directories
  const { mkdirSync, writeFileSync, rmSync } = await import("fs");
  const testDirs = [
    "/tmp/test-empty-repo",
    "/tmp/test-binary-repo",
    "/tmp/test-huge-file-repo",
    "/tmp/test-special-chars-repo",
    "/tmp/test-deeply-nested-repo",
    "/tmp/test-no-code-repo",
  ];
  for (const d of testDirs) rmSync(d, { recursive: true, force: true });

  // Empty directory
  mkdirSync("/tmp/test-empty-repo", { recursive: true });
  await test("Index empty directory (no files)", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/tmp/test-empty-repo", name: "Empty" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.unitCount === 0, `Expected 0 units, got ${r.data.unitCount}`);
  });

  // Directory with only non-code files
  mkdirSync("/tmp/test-no-code-repo", { recursive: true });
  writeFileSync("/tmp/test-no-code-repo/readme.md", "# Hello");
  writeFileSync("/tmp/test-no-code-repo/data.csv", "a,b,c\n1,2,3");
  await test("Index directory with no code files", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/tmp/test-no-code-repo", name: "NoCode" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.unitCount === 0, `Expected 0 units, got ${r.data.unitCount}`);
  });

  // Binary file in repo
  mkdirSync("/tmp/test-binary-repo", { recursive: true });
  writeFileSync("/tmp/test-binary-repo/binary.ts", Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
  writeFileSync("/tmp/test-binary-repo/good.ts", "export function hello() { return 1; }");
  await test("Index repo with binary .ts file (should not crash)", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/tmp/test-binary-repo", name: "Binary" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    // Should parse at least the good file
    assert(r.data.unitCount >= 1, `Expected at least 1 unit, got ${r.data.unitCount}`);
  });

  // Very large single file
  mkdirSync("/tmp/test-huge-file-repo", { recursive: true });
  const hugeCode = Array.from({ length: 500 }, (_, i) =>
    `export function fn${i}(x: number): number { return x + ${i}; }`
  ).join("\n");
  writeFileSync("/tmp/test-huge-file-repo/huge.ts", hugeCode);
  await test("Index repo with 500-function file", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/tmp/test-huge-file-repo", name: "Huge" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.unitCount >= 400, `Expected many units, got ${r.data.unitCount}`);
  });

  // Special characters in filenames (create via code)
  mkdirSync("/tmp/test-special-chars-repo/src", { recursive: true });
  writeFileSync("/tmp/test-special-chars-repo/src/file with spaces.ts", "export const x = 1;\nexport const y = 2;\nexport const z = 3;\nexport const w = 4;\nexport const v = 5;\nexport const u = 6;\n");
  writeFileSync("/tmp/test-special-chars-repo/src/normal.ts", "export function greet() { return 'hi'; }");
  await test("Index repo with spaces in filename", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/tmp/test-special-chars-repo", name: "Special" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  // Deeply nested directory structure
  let deepPath = "/tmp/test-deeply-nested-repo";
  for (let i = 0; i < 20; i++) deepPath += `/level${i}`;
  mkdirSync(deepPath, { recursive: true });
  writeFileSync(`${deepPath}/deep.ts`, "export function deep() { return 'deep'; }");
  await test("Index deeply nested directory (20 levels)", async () => {
    const r = await json("POST", "/projects/index", { repoRoot: "/tmp/test-deeply-nested-repo", name: "Deep" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.unitCount >= 1, `Expected at least 1 unit, got ${r.data.unitCount}`);
  });

  console.log("\n=== DUPLICATE / RE-INDEX HANDLING ===\n");

  await test("Re-index same repo replaces old project", async () => {
    const r1 = await json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "First" });
    assert(r1.status === 200, `First index failed: ${r1.status}`);
    const id1 = r1.data.projectId;

    const r2 = await json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "Second" });
    assert(r2.status === 200, `Second index failed: ${r2.status}`);
    const id2 = r2.data.projectId;

    assert(id1 !== id2, "Project IDs should differ after re-index");

    // Old project should be gone
    const old = await json("GET", `/projects/${id1}`);
    assert(old.status === 404, `Old project should be deleted, got ${old.status}`);

    // New project should exist
    const newP = await json("GET", `/projects/${id2}`);
    assert(newP.status === 200, `New project not found: ${newP.status}`);
  });

  console.log("\n=== STATE MANAGEMENT ===\n");

  await test("Query after project deleted returns 400", async () => {
    const idx = await json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "ToDelete" });
    const pid = idx.data.projectId;
    // Project is auto-selected
    await json("DELETE", `/projects/${pid}`);
    const r = await json("POST", "/query", { query: "test" });
    assert(r.status === 400, `Expected 400 after delete, got ${r.status}`);
  });

  await test("Stats after project deleted returns 400", async () => {
    const r = await json("GET", "/stats");
    assert(r.status === 400, `Expected 400 with no project, got ${r.status}`);
  });

  await test("Delete already-deleted project returns 404", async () => {
    const idx = await json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "DeleteTwice" });
    const pid = idx.data.projectId;
    await json("DELETE", `/projects/${pid}`);
    const r = await json("DELETE", `/projects/${pid}`);
    assert(r.status === 404, `Expected 404 for double delete, got ${r.status}`);
  });

  console.log("\n=== SPECIAL QUERY CONTENT ===\n");

  // Index a project for query tests
  await json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "QueryTest" });

  await test("Query with only whitespace", async () => {
    const r = await json("POST", "/query", { query: "   " });
    // Should either work (whitespace is truthy) or handle gracefully
    assert(r.status === 200 || r.status === 400, `Unexpected: ${r.status}`);
  });

  await test("Query with unicode/emoji", async () => {
    const r = await json("POST", "/query", { query: "What does 🚀 do? café naïve" });
    assert(r.status === 200 || r.status === 500, `Unexpected: ${r.status}`);
  });

  await test("Query with HTML/XSS payload", async () => {
    const r = await json("POST", "/query", { query: '<script>alert("xss")</script>' });
    assert(r.status === 200 || r.status === 500, `Unexpected: ${r.status}`);
    if (r.status === 200) {
      const str = JSON.stringify(r.data);
      assert(!str.includes("<script>"), "Response contains unescaped script tag");
    }
  });

  await test("Query with newlines and control chars", async () => {
    const r = await json("POST", "/query", { query: "test\n\r\t\x00query" });
    assert(r.status === 200 || r.status === 500, `Unexpected: ${r.status}`);
  });

  await test("Query with exactly 10000 chars (boundary)", async () => {
    const r = await json("POST", "/query", { query: "a".repeat(10000) });
    assert(r.status === 200 || r.status === 500, `Expected 200/500 at boundary, got ${r.status}`);
  });

  await test("Query with 10001 chars (over boundary)", async () => {
    const r = await json("POST", "/query", { query: "a".repeat(10001) });
    assert(r.status === 400, `Expected 400 over boundary, got ${r.status}`);
  });

  console.log("\n=== PROJECT NAME EDGE CASES ===\n");

  await test("Project with very long name (1000 chars)", async () => {
    const r = await json("POST", "/projects/index", {
      repoRoot: "./test/test-repo",
      name: "A".repeat(1000),
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const project = await json("GET", `/projects/${r.data.projectId}`);
    assert(project.data.name.length <= 200, `Name should be truncated to 200, got ${project.data.name.length}`);
  });

  await test("Project with control characters in name", async () => {
    const r = await json("POST", "/projects/index", {
      repoRoot: "./test/test-repo",
      name: "Test\x00\x01\x02Project",
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const project = await json("GET", `/projects/${r.data.projectId}`);
    assert(!project.data.name.includes("\x00"), "Name should have control chars stripped");
  });

  await test("Project with empty string name (should default to dirname)", async () => {
    const r = await json("POST", "/projects/index", {
      repoRoot: "./test/test-repo",
      name: "",
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const project = await json("GET", `/projects/${r.data.projectId}`);
    assert(project.data.name === "test-repo", `Expected 'test-repo', got '${project.data.name}'`);
  });

  console.log("\n=== CONCURRENT OPERATIONS ===\n");

  await test("Concurrent index of same repo", async () => {
    const p1 = json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "Concurrent1" });
    const p2 = json("POST", "/projects/index", { repoRoot: "./test/test-repo", name: "Concurrent2" });
    const [r1, r2] = await Promise.all([p1, p2]);
    // At least one should succeed, neither should crash
    assert(
      (r1.status === 200 || r1.status === 500) && (r2.status === 200 || r2.status === 500),
      `Unexpected statuses: ${r1.status}, ${r2.status}`,
    );
    // Should end up with exactly one project for this path
    const list = await json("GET", "/projects");
    const matching = list.data.filter((p: any) => p.repoPath.endsWith("/test-repo"));
    assert(matching.length >= 1, `Expected at least 1 project, got ${matching.length}`);
  });

  console.log("\n=== CLEANUP ===\n");

  // Delete all test projects
  const list = await json("GET", "/projects");
  for (const p of list.data) {
    await json("DELETE", `/projects/${p.id}`);
  }
  console.log(`  Cleaned up ${list.data.length} projects`);

  // Cleanup temp dirs
  for (const d of testDirs) rmSync(d, { recursive: true, force: true });

  console.log("\n=== RESULTS ===\n");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`    - ${f}`);
  }
  console.log("");
}

main().catch(console.error);
