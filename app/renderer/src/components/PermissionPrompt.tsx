/**
 * 权限确认弹窗 — 工具执行前拦截
 */

import { useState, useEffect, useCallback } from "react";

interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  description: string;
  dangerLevel?: "safe" | "normal" | "dangerous";
}

/** MCP 工具名格式 mcp__<server>__<tool>——解析出来源服务器（对齐 OMP：审批弹窗标注来源） */
function mcpOrigin(toolName: string): string | null {
  if (!toolName.startsWith("mcp__")) return null;
  const parts = toolName.split("__");
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

export function PermissionPrompt(): JSX.Element | null {
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  useEffect(() => {
    const unsub = window.electronAPI.agent.onPermissionRequest((data: any) => {
      console.log("[PermissionPrompt] 收到权限请求:", data.requestId, data.toolName, data.type);
      if (data.type === "ask") return; // AskUserQuestion, not tool permission
      setPending((prev) => [...prev, data]);
    });
    return () => { unsub(); };
  }, []);

  const respond = useCallback((requestId: string, behavior: "allow" | "deny", alwaysAllow: boolean) => {
    window.electronAPI.agent.respondPermission(requestId, behavior, alwaysAllow);
    setPending((prev) => prev.filter((p) => p.requestId !== requestId));
  }, []);

  if (pending.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      {pending.map((req) => {
        const origin = mcpOrigin(req.toolName);
        return (
        <div key={req.requestId} className="bg-surface border border-border rounded-xl p-6 max-w-md w-full shadow-2xl mx-4">
          <div className="flex items-start gap-3 mb-4">
            <span className={`text-lg ${req.dangerLevel === "dangerous" ? "text-danger" : "text-accent"}`}>
              {req.dangerLevel === "dangerous" ? "⚠" : "?"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-medium text-text-primary break-words">{req.toolName}</span>
                {origin && (
                  <span className="text-[length:var(--text-3xs)] px-1 py-0.5 rounded bg-info-soft text-info shrink-0">
                    来自 MCP 服务器：{origin}
                  </span>
                )}
              </div>
              <div className="text-xs text-text-secondary mt-1 selectable">{req.description}</div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="px-4 py-1.5 text-xs rounded-md bg-surface-alt border border-border text-text-secondary hover:text-text-primary transition-colors"
              onClick={() => respond(req.requestId, "deny", false)}
            >
              拒绝
            </button>
            <button
              className="px-4 py-1.5 text-xs rounded-md btn-accent"
              onClick={() => respond(req.requestId, "allow", false)}
            >
              允许
            </button>
            <button
              className="px-4 py-1.5 text-xs rounded-md btn-accent"
              onClick={() => respond(req.requestId, "allow", true)}
            >
              始终允许
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
