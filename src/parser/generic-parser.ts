import path from "path";
import { Node as TSNode } from "web-tree-sitter";
import { v4 as uuidv4 } from "uuid";
import { CodeUnit, CodeUnitKind } from "./types";
import { createParser } from "./parser-init";

interface TreeSitterLanguageConfig {
  language: string;
  langKey: string;
  declarations: Record<string, CodeUnitKind>;
  importNodeTypes: Set<string>;
  callNodeTypes: Set<string>;
}

const LANGUAGE_BY_EXTENSION: Record<string, TreeSitterLanguageConfig> = {
  ".rs": {
    language: "rust",
    langKey: "rust",
    declarations: {
      function_item: "function",
      impl_item: "class",
      struct_item: "class",
      enum_item: "class",
      trait_item: "class",
      mod_item: "module",
    },
    importNodeTypes: new Set(["use_declaration", "extern_crate_declaration"]),
    callNodeTypes: new Set(["call_expression", "macro_invocation"]),
  },
  ".go": {
    language: "go",
    langKey: "go",
    declarations: {
      function_declaration: "function",
      method_declaration: "method",
      type_declaration: "class",
    },
    importNodeTypes: new Set(["import_declaration"]),
    callNodeTypes: new Set(["call_expression"]),
  },
  ".java": {
    language: "java",
    langKey: "java",
    declarations: {
      class_declaration: "class",
      interface_declaration: "class",
      enum_declaration: "class",
      record_declaration: "class",
      method_declaration: "method",
      constructor_declaration: "method",
    },
    importNodeTypes: new Set(["import_declaration"]),
    callNodeTypes: new Set(["method_invocation", "object_creation_expression"]),
  },
  ".cs": {
    language: "csharp",
    langKey: "c_sharp",
    declarations: {
      class_declaration: "class",
      interface_declaration: "class",
      struct_declaration: "class",
      enum_declaration: "class",
      record_declaration: "class",
      method_declaration: "method",
      constructor_declaration: "method",
    },
    importNodeTypes: new Set(["using_directive"]),
    callNodeTypes: new Set(["invocation_expression", "object_creation_expression"]),
  },
};

export const GENERIC_SOURCE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXTENSION));

export function isGenericSourceFile(filePath: string): boolean {
  return LANGUAGE_BY_EXTENSION[path.extname(filePath)] !== undefined;
}

function languageForFile(filePath: string): TreeSitterLanguageConfig {
  const config = LANGUAGE_BY_EXTENSION[path.extname(filePath)];
  if (!config) throw new Error(`Unsupported tree-sitter source extension: ${path.extname(filePath)}`);
  return config;
}

function nodeName(node: TSNode): string | null {
  const named = node.childForFieldName("name");
  if (named?.text) return named.text;

  const identifier = node.namedChildren.find((child) =>
    /^(identifier|type_identifier|field_identifier|property_identifier)$/.test(child.type),
  );
  if (identifier?.text) return identifier.text;

  const match = node.text.match(/\b([A-Za-z_][\w:]*)\b/);
  return match?.[1] ?? null;
}

function collectImports(rootNode: TSNode, config: TreeSitterLanguageConfig): string[] {
  const imports = new Set<string>();
  function walk(node: TSNode): void {
    if (config.importNodeTypes.has(node.type)) imports.add(node.text);
    for (const child of node.children) walk(child);
  }
  walk(rootNode);
  return Array.from(imports);
}

function collectCalledFunctions(node: TSNode, config: TreeSitterLanguageConfig): string[] {
  const calls = new Set<string>();
  function walk(current: TSNode): void {
    if (config.callNodeTypes.has(current.type)) {
      const target =
        current.childForFieldName("function") ??
        current.childForFieldName("method") ??
        current.childForFieldName("name") ??
        current.namedChildren[0];
      if (target?.text) {
        calls.add(target.text);
        const nestedName = nodeName(target);
        if (nestedName) calls.add(nestedName);
      }
    }
    for (const child of current.children) walk(child);
  }
  walk(node);
  return Array.from(calls);
}

function parentDeclarationName(node: TSNode, config: TreeSitterLanguageConfig): string | null {
  let current = node.parent;
  while (current) {
    const kind = config.declarations[current.type];
    if (kind === "class") return nodeName(current);
    current = current.parent;
  }
  return null;
}

function shouldSkipNestedDeclaration(node: TSNode, config: TreeSitterLanguageConfig): boolean {
  const kind = config.declarations[node.type];
  if (kind === "method") return false;
  let current = node.parent;
  while (current) {
    if (config.declarations[current.type]) return true;
    current = current.parent;
  }
  return false;
}

export async function parseGenericSource(source: string, filePath: string): Promise<CodeUnit[]> {
  const config = languageForFile(filePath);
  const parser = await createParser(config.langKey);
  const tree = parser.parse(source);
  if (!tree) return [];

  const rootNode = tree.rootNode;
  const imports = collectImports(rootNode, config);
  const units: CodeUnit[] = [];

  function makeUnit(node: TSNode, kind: CodeUnitKind, name: string, parentName: string | null): CodeUnit {
    return {
      id: uuidv4(),
      filePath,
      language: config.language,
      kind,
      name,
      code: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentName,
      imports,
      docstring: null,
      exportedNames: kind === "module" ? [] : [name],
      calledFunctions: collectCalledFunctions(node, config),
      isVendored: false,
    };
  }

  function walk(node: TSNode): void {
    const kind = config.declarations[node.type];
    if (kind && !shouldSkipNestedDeclaration(node, config)) {
      const name = nodeName(node) ?? path.basename(filePath, path.extname(filePath));
      units.push(makeUnit(node, kind, name, kind === "method" ? parentDeclarationName(node, config) : null));
    }
    for (const child of node.children) walk(child);
  }
  walk(rootNode);

  if (units.length === 0 || source.split("\n").length > 30) {
    units.push(makeUnit(rootNode, "module", path.basename(filePath, path.extname(filePath)), null));
  }

  return units.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
}
