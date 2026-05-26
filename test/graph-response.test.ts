import test from "node:test";
import assert from "node:assert/strict";
import { buildDirectoryGraphResponse, buildFileGraphResponse } from "../src/api/graph-response";
import { CodeUnit } from "../src/parser/types";

function unit(id: string, filePath: string, kind: CodeUnit["kind"] = "module"): CodeUnit {
  return {
    id,
    filePath,
    language: "typescript",
    kind,
    name: id,
    code: `export const ${id} = true;`,
    startLine: 1,
    endLine: 1,
    parentName: null,
    imports: [],
    docstring: null,
    exportedNames: [],
    calledFunctions: [],
    isVendored: false,
  };
}

test("buildFileGraphResponse groups units by file and preserves edge types", () => {
  const response = buildFileGraphResponse(
    [
      unit("api", "src/api/server.ts", "module"),
      unit("handler", "src/api/server.ts", "function"),
      unit("repo", "src/db/project-repo.ts", "class"),
    ],
    [
      {
        sourceFile: "src/api/server.ts",
        targetFile: "src/db/project-repo.ts",
        importStatement: "import repo",
        edgeType: "imports",
      },
    ],
  );

  assert.deepEqual(response.nodes, [
    { filePath: "src/api/server.ts", unitCount: 2, kinds: ["module", "function"] },
    { filePath: "src/db/project-repo.ts", unitCount: 1, kinds: ["class"] },
  ]);
  assert.deepEqual(response.edges, [{ from: "src/api/server.ts", to: "src/db/project-repo.ts", type: "imports" }]);
});

test("buildDirectoryGraphResponse deduplicates directory edges and drops self loops", () => {
  const response = buildDirectoryGraphResponse(
    [unit("api", "src/api/server.ts"), unit("routes", "src/api/routes.ts"), unit("repo", "src/db/project-repo.ts")],
    [
      {
        sourceFile: "src/api/server.ts",
        targetFile: "src/db/project-repo.ts",
        importStatement: "import repo",
        edgeType: "imports",
      },
      {
        sourceFile: "src/api/routes.ts",
        targetFile: "src/db/project-repo.ts",
        importStatement: "import repo",
        edgeType: "imports",
      },
      {
        sourceFile: "src/api/server.ts",
        targetFile: "src/api/routes.ts",
        importStatement: "import routes",
        edgeType: "imports",
      },
    ],
  );

  assert.deepEqual(response.nodes, [
    { directory: "src/api", fileCount: 2, unitCount: 2 },
    { directory: "src/db", fileCount: 1, unitCount: 1 },
  ]);
  assert.deepEqual(response.edges, [{ from: "src/api", to: "src/db" }]);
});
