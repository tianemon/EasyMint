import fs from "node:fs";
import path from "node:path";
import { getPiSessionDir } from "./pi-session-dir";
import { t } from "./ui-language";

const receiptName = ".relocating-project.json";

/** Keep the old history available until the project record has been committed. */
export async function relocateProjectSessions<T>(
  id: string,
  oldPath: string,
  newPath: string,
  commit: () => T,
): Promise<T> {
  const from = getPiSessionDir(oldPath);
  const to = getPiSessionDir(newPath);
  if (!fs.lstatSync(from).isDirectory() || !fs.lstatSync(to).isDirectory()) {
    throw new Error(t("messages.projectRelocationHistoryConflict"));
  }
  if (path.relative(from, to) === "") return commit();

  const receipt = JSON.stringify({ id, oldPath, newPath });
  const isInterruptedCopy = (): boolean => {
    const file = path.join(to, receiptName);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return Boolean(stat?.isFile() && stat.size === Buffer.byteLength(receipt) && fs.readFileSync(file, "utf8") === receipt);
  };
  const checkDestination = (): void => {
    if (!fs.lstatSync(to).isDirectory() || (fs.readdirSync(to).length > 0 && !isInterruptedCopy())) {
      throw new Error(t("messages.projectRelocationHistoryConflict"));
    }
  };
  checkDestination();
  if (fs.readdirSync(from).length === 0) return commit();

  const stage = fs.mkdtempSync(path.join(path.dirname(to), ".relocate-"));
  const copy = path.join(stage, "copy");
  const replaced = path.join(stage, "destination");
  try {
    await fs.promises.cp(from, copy, {
      recursive: true,
      filter: async source => {
        if (source === path.join(from, receiptName)) return false;
        const stat = await fs.promises.lstat(source);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error(t("messages.projectRelocationHistoryConflict"));
        return true;
      },
    });
    fs.writeFileSync(path.join(copy, receiptName), receipt, { flag: "wx", mode: 0o600 });
    checkDestination();
    fs.renameSync(to, replaced);
    let result: T;
    try {
      fs.renameSync(copy, to);
      result = commit();
    } catch (error) {
      if (fs.existsSync(to)) fs.renameSync(to, copy);
      fs.renameSync(replaced, to);
      throw error;
    }
    // Detach the old history from the SDK's lookup before deleting the temporary files.
    try { fs.renameSync(from, path.join(stage, "source")); }
    catch (error) { console.warn("[project] Could not remove old session directory after relocation:", error); }
    try { fs.unlinkSync(path.join(to, receiptName)); }
    catch (error) { console.warn("[project] Could not remove the session relocation receipt:", error); }
    return result;
  } finally {
    void fs.promises.rm(stage, { recursive: true, force: true }).catch(error => {
      console.warn("[project] Could not clean up staged session relocation:", error);
    });
  }
}
