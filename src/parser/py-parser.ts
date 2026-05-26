import path from "path";
import { Node as TSNode } from "web-tree-sitter";
import { v4 as uuidv4 } from "uuid";
import { CodeUnit, CodeUnitKind } from "./types";
import { createParser } from "./parser-init";

function getDocstring(node: TSNode): string | null {
  const body = node.childForFieldName("body");
  if (!body) return null;
  const firstChild = body.namedChildren[0];
  if (
    firstChild &&
    firstChild.type === "expression_statement" &&
    firstChild.namedChildren[0] &&
    firstChild.namedChildren[0].type === "string"
  ) {
    return firstChild.namedChildren[0].text;
  }
  return null;
}

function collectCalledFunctions(node: TSNode): string[] {
  const calls = new Set<string>();

  function walk(n: TSNode): void {
    if (n.type === "call") {
      const fn = n.childForFieldName("function");
      if (fn) {
        if (fn.type === "identifier") {
          calls.add(fn.text);
        } else if (fn.type === "attribute") {
          calls.add(fn.text);
          const attribute = fn.childForFieldName("attribute");
          if (attribute) calls.add(attribute.text);
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
    if (child.type === "import_statement" || child.type === "import_from_statement") {
      imports.push(child.text);
    }
  }
  return imports;
}

function isTopLevelCode(node: TSNode): boolean {
  return (
    node.type !== "import_statement" &&
    node.type !== "import_from_statement" &&
    node.type !== "function_definition" &&
    node.type !== "class_definition" &&
    node.type !== "decorated_definition" &&
    node.type !== "comment" &&
    node.isNamed
  );
}

function lineCount(node: TSNode): number {
  return node.endPosition.row - node.startPosition.row + 1;
}

function hasModuleContent(rootNode: TSNode): boolean {
  return rootNode.children.some(
    (child) =>
      child.isNamed &&
      child.type !== "import_statement" &&
      child.type !== "import_from_statement" &&
      child.type !== "comment",
  );
}

export async function parsePython(source: string, filePath: string): Promise<CodeUnit[]> {
  const parser = await createParser("python");
  const tree = parser.parse(source);
  if (!tree) return [];

  const rootNode = tree.rootNode;
  const imports = collectImports(rootNode);
  const units: CodeUnit[] = [];

  function makeUnit(node: TSNode, kind: CodeUnitKind, name: string, parentName: string | null): CodeUnit {
    return {
      id: uuidv4(),
      filePath,
      language: "python",
      kind,
      name,
      code: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentName,
      imports,
      docstring: getDocstring(node),
      exportedNames: [],
      calledFunctions: collectCalledFunctions(node),
      isVendored: false,
    };
  }

  for (const child of rootNode.children) {
    if (child.type === "function_definition") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        units.push(makeUnit(child, "function", nameNode.text, null));
      }
    } else if (child.type === "class_definition") {
      const nameNode = child.childForFieldName("name");
      const className = nameNode ? nameNode.text : "AnonymousClass";
      units.push(makeUnit(child, "class", className, null));

      // Extract methods from class body
      const body = child.childForFieldName("body");
      if (body) {
        for (const member of body.namedChildren) {
          if (member.type === "function_definition") {
            const methodName = member.childForFieldName("name");
            if (methodName) {
              units.push(makeUnit(member, "method", methodName.text, className));
            }
          }
        }
      }
    } else if (child.type === "decorated_definition") {
      // Handle decorated functions/classes
      const definition = child.namedChildren[child.namedChildren.length - 1];
      if (definition && definition.type === "function_definition") {
        const nameNode = definition.childForFieldName("name");
        if (nameNode) {
          units.push(makeUnit(child, "function", nameNode.text, null));
        }
      } else if (definition && definition.type === "class_definition") {
        const nameNode = definition.childForFieldName("name");
        const className = nameNode ? nameNode.text : "AnonymousClass";
        units.push(makeUnit(child, "class", className, null));

        const body = definition.childForFieldName("body");
        if (body) {
          for (const member of body.namedChildren) {
            if (member.type === "function_definition") {
              const methodName = member.childForFieldName("name");
              if (methodName) {
                units.push(makeUnit(member, "method", methodName.text, className));
              }
            }
          }
        }
      }
    }
  }

  // Module-level code detection
  let topLevelLines = 0;
  for (const child of rootNode.children) {
    if (isTopLevelCode(child)) {
      topLevelLines += lineCount(child);
    }
  }

  if ((topLevelLines > 5 || units.length === 0) && hasModuleContent(rootNode)) {
    const basename = path.basename(filePath, path.extname(filePath));
    units.push({
      id: uuidv4(),
      filePath,
      language: "python",
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
