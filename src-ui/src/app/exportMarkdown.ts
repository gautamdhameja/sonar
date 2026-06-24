import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./runtime";

export async function saveMarkdownFile(defaultPath: string, contents: string): Promise<boolean> {
  if (isTauriRuntime()) {
    const path = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return false;
    await invoke<void>("export_markdown", { path, contents });
    return true;
  }

  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultPath;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
