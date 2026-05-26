import path from "path";
import { Parser, Language } from "web-tree-sitter";

let initialized = false;
const languages: Record<string, Language> = {};

const GRAMMARS_DIR = path.resolve(__dirname, "../../grammars");

export async function ensureParserInit(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

export async function createParser(languageName: string): Promise<Parser> {
  await ensureParserInit();
  const parser = new Parser();
  parser.setLanguage(await getLanguage(languageName));
  return parser;
}

export async function getLanguage(name: string): Promise<Language> {
  if (!languages[name]) {
    languages[name] = await Language.load(path.join(GRAMMARS_DIR, `tree-sitter-${name}.wasm`));
  }
  return languages[name];
}
