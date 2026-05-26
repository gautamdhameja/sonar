import test from "node:test";
import assert from "node:assert/strict";
import { parsePersona, PersonaValidationError } from "../src/persona/schema";

test("parsePersona returns defaults when persona is absent", () => {
  assert.deepEqual(parsePersona(undefined), {
    role: "other",
    technicalBackground: "basic",
    avoidJargon: true,
    explanationDepth: "standard",
  });
});

test("parsePersona accepts a complete persona", () => {
  const persona = parsePersona({
    role: "sales",
    roleDescription: "Enterprise account executive",
    technicalBackground: "none",
    businessContext: "Understand customer-facing value",
    preferredAnalogies: ["retail operations", "support desk"],
    avoidJargon: true,
    explanationDepth: "deep",
  });

  assert.deepEqual(persona, {
    role: "sales",
    roleDescription: "Enterprise account executive",
    technicalBackground: "none",
    businessContext: "Understand customer-facing value",
    preferredAnalogies: ["retail operations", "support desk"],
    avoidJargon: true,
    explanationDepth: "deep",
  });
});

test("parsePersona rejects invalid persona fields", () => {
  assert.throws(
    () => parsePersona({ role: "invalid_role" }),
    (err) => err instanceof PersonaValidationError && /persona.role/.test(err.message),
  );
  assert.throws(
    () => parsePersona({ avoidJargon: "yes" }),
    (err) => err instanceof PersonaValidationError && /persona.avoidJargon/.test(err.message),
  );
});
