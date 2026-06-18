import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./runtime";

export async function saveMarkdownFile(defaultPath: string, contents: string): Promise<boolean> {
  if (isTauriRuntime()) {
    return invoke<boolean>("export_markdown", { defaultFileName: defaultPath, contents });
  }

  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultPath;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
