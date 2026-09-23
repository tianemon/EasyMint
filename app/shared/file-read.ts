/**
 * 文本文件读取的结果口径（主进程与渲染层共用）。
 *
 * 为什么要区分失败原因、而不是返回空串：越界与文件不存在都返回 "" 时，调用方无法与
 * 「这真的是个空文件」区分——于是打开一个空白编辑器、什么也不说，用户点了等于没反应。
 * 原因码与用户提示同放一处：将来多一个入口（文件树、点链接时的 toast）也是同一句话。
 */

/** 读取失败的原因码 */
export type FileReadFailReason = "missing" | "outside-project";

export type FileReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: FileReadFailReason };

/** 面向用户的一句话（只说发生了什么，不写内部机制） */
export const FILE_READ_HINTS: Record<FileReadFailReason, string> = {
  missing: "文件已变更或删除",
  "outside-project": "该文件不在当前项目内，无法打开",
};
