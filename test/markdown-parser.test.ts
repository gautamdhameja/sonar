import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../src/parser/markdown-parser";

test("parseMarkdown creates a retrievable module unit", () => {
  const units = parseMarkdown("# Birbal\n\nDaily enterprise AI digest.", "README.md");

  assert.equal(units.length, 1);
  assert.equal(units[0].kind, "module");
  assert.equal(units[0].language, "markdown");
  assert.equal(units[0].name, "Birbal");
  assert.match(units[0].code, /Daily enterprise/);
});
