import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./runtime";

export async function saveMarkdownFile(defaultPath: string, contents: string): Promise<void> {
  if (isTauriRuntime()) {
    const target = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (typeof target === "string") {
      await invoke("export_markdown", { path: target, contents });
    }
    return;
  }

  const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultPath;
  anchor.click();
  URL.revokeObjectURL(url);
}
