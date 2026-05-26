import path from "path";
import { Node as TSNode } from "web-tree-sitter";
import { v4 as uuidv4 } from "uuid";
import { CodeUnit, CodeUnitKind } from "./types";
import { createParser } from "./parser-init";

function getLanguageForFile(filePath: string): { langKey: string; language: string } {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".ts":
      return { langKey: "typescript", language: "typescript" };
    case ".tsx":
      return { langKey: "tsx", language: "typescript" };
    case ".js":
    case ".jsx":
      return { langKey: "javascript", language: "javascript" };
    default:
      throw new Error(`Unsupported file extension: ${ext}`);
  }
}

function getJSDoc(node: TSNode): string | null {
  const prev = node.previousNamedSibling;
  if (prev && prev.type === "comment" && prev.text.startsWith("/**")) {
    return prev.text;
  }
  return null;
}

function collectCalledFunctions(node: TSNode): string[] {
  const calls = new Set<string>();

  function walk(n: TSNode): void {
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      if (fn) {
        if (fn.type === "identifier") {
          calls.add(fn.text);
        } else if (fn.type === "member_expression") {
          calls.add(fn.text);
          const property = fn.childForFieldName("property");
          if (property) calls.add(property.text);
        }
      }
    }
    for (const child of n.children) {
      walk(child);
    }
  }

  walk(node);
  return Array.from(calls);
}

function collectImports(rootNode: TSNode): string[] {
  const imports: string[] = [];
  for (const child of rootNode.children) {
    if (child.type === "import_statement") {
      imports.push(child.text);
    }
  }
  return imports;
}

function isTopLevelCode(node: TSNode): boolean {
  return (
    node.type !== "import_statement" &&
    node.type !== "function_declaration" &&
    node.type !== "class_declaration" &&
    node.type !== "export_statement" &&
    node.type !== "lexical_declaration" &&
    node.type !== "variable_declaration" &&
    node.type !== "comment" &&
    node.isNamed
  );
}

function lineCount(node: TSNode): number {
  return node.endPosition.row - node.startPosition.row + 1;
}

function hasModuleContent(rootNode: TSNode): boolean {
  return rootNode.children.some((child) =>
    child.isNamed &&
    child.type !== "import_statement" &&
    child.type !== "comment"
  );
}

export async function parseTypeScript(source: string, filePath: string): Promise<CodeUnit[]> {
  const { langKey, language } = getLanguageForFile(filePath);
  const parser = await createParser(langKey);
  const tree = parser.parse(source);
  if (!tree) return [];

  const rootNode = tree.rootNode;
  const imports = collectImports(rootNode);
  const units: CodeUnit[] = [];

  function makeUnit(
    node: TSNode,
    kind: CodeUnitKind,
    name: string,
    parentName: string | null,
    docNode?: TSNode | null,
  ): CodeUnit {
    return {
      id: uuidv4(),
      filePath,
      language,
      kind,
      name,
      code: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentName,
      imports,
      docstring: docNode ? docNode.text : getJSDoc(node),
      exportedNames: [],
      calledFunctions: collectCalledFunctions(node),
      isVendored: false,
    };
  }

  function extractFromNode(node: TSNode): void {
    // Unwrap export_statement to get the actual declaration
    if (node.type === "export_statement") {
      const declaration = node.childForFieldName("declaration");
      if (declaration) {
        extractFromNode(declaration);
      }
      return;
    }

    if (node.type === "function_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        units.push(makeUnit(node, "function", nameNode.text, null));
      }
    } else if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      const className = nameNode ? nameNode.text : "AnonymousClass";
      units.push(makeUnit(node, "class", className, null));

      // Extract methods from class body
      const body = node.childForFieldName("body");
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === "method_definition") {
            const methodName = member.childForFieldName("name");
            if (methodName) {
              units.push(makeUnit(member, "method", methodName.text, className));
            }
          }
        }
      }
    } else if (
      node.type === "lexical_declaration" ||
      node.type === "variable_declaration"
    ) {
      // Arrow functions assigned to variables
      for (const declarator of node.namedChildren) {
        if (declarator.type === "variable_declarator") {
          const value = declarator.childForFieldName("value");
          if (value && value.type === "arrow_function") {
            const nameNode = declarator.childForFieldName("name");
            if (nameNode) {
              units.push(makeUnit(node, "function", nameNode.text, null));
            }
          }
        }
      }
    }
  }

  for (const child of rootNode.children) {
    extractFromNode(child);
  }

  // Module-level code detection
  let topLevelLines = 0;
  for (const child of rootNode.children) {
    if (isTopLevelCode(child)) {
      topLevelLines += lineCount(child);
    }
    // Also check inside export_statement for non-declaration exports
    if (child.type === "export_statement" && !child.childForFieldName("declaration")) {
      topLevelLines += lineCount(child);
    }
  }

  if ((topLevelLines > 5 || units.length === 0) && hasModuleContent(rootNode)) {
    const basename = path.basename(filePath, path.extname(filePath));
    units.push({
      id: uuidv4(),
      filePath,
      language,
      kind: "module",
      name: basename,
      code: source,
      startLine: 1,
      endLine: source.split("\n").length,
      parentName: null,
      imports,
      docstring: null,
      exportedNames: [],
      calledFunctions: collectCalledFunctions(rootNode),
      isVendored: false,
    });
  }

  return units;
}
