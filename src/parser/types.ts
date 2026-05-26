export interface CodeUnit {
  id: string; // UUID
  filePath: string; // relative to repo root, e.g. "src/utils/helper.ts"
  language: string; // "typescript" | "python" | "javascript"
  kind: CodeUnitKind; // function, class, method, module
  name: string; // function/class/method name, or filename for module
  code: string; // full source code of the unit
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  parentName: string | null; // class name if this is a method
  imports: string[]; // import statements from the same file
  docstring: string | null; // extracted docstring/JSDoc if present
  exportedNames: string[]; // names exported by this unit (for dependency resolution)
  calledFunctions: string[]; // function names called within this unit (best effort)
  isVendored: boolean; // true if this unit is from a vendored/third-party dependency
}

export type CodeUnitKind = "function" | "class" | "method" | "module";
