import path from "node:path";

/** Capability bound to this editor's originally opened HTML, never a renderer-supplied path. */
export class EditorFileAccess {
  private readonly originals = new WeakMap<object, string>();

  register(contents: object, filePath?: string): void {
    if (filePath && /\.html?$/i.test(path.extname(filePath))) this.originals.set(contents, filePath);
  }

  remove(contents: object): void { this.originals.delete(contents); }

  target(sender: object, isMainFrame: boolean): string {
    const filePath = isMainFrame ? this.originals.get(sender) : undefined;
    if (!filePath) throw new Error("当前编辑器没有可打开的原型文件");
    return filePath;
  }
}
