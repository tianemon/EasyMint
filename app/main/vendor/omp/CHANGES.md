# omp → EM 适配变更记录

> 源版本: oh-my-pi v17.0.8
> vendor 位置: app/main/vendor/omp/
> 工作副本: app/main/services/

## Bun API 替换清单

受影响的文件（按 API 分类）：

### Bun.sleep(ms) → setTimeout Promise
- `mcp/manager.ts` L112, L931

### Bun.env.XXX → process.env.XXX  
- `mcp/timeout.ts` L9
- `mcp/transports/stdio.ts` L573

### Bun.file().text() → fs.promises.readFile
- `mcp/transports/stdio.ts` L184

### Bun.file().json() → JSON.parse(fs.readFileSync(…))
- `mcp/smithery-auth.ts` L73

### Bun.write() → fs.writeFileSync (需手动 mkdirSync(dirname))
- `mcp/smithery-auth.ts` L90

### Bun.spawn() → child_process.spawn
- `mcp/transports/stdio.ts` L594

### Bun.hash() → crypto.createHash
- `task/worktree.ts` L417（跳过，EM 不需要 worktree）

### Bun.stringWidth() → 跳过
- `mcp/render.ts` L37（EM 用 Electron 渲染，不需要 TUI）

## 文件清单

### MCP 系统 — vendor/omp/mcp/ (17 files)
- types.ts, index.ts, client.ts, config.ts, config-writer.ts, json-rpc.ts
- loader.ts, manager.ts, tool-bridge.ts, tool-cache.ts, startup-events.ts
- timeout.ts, render.ts
- transports/index.ts, transports/http.ts, transports/sse.ts, transports/stdio.ts

### Task 系统 — vendor/omp/task/ (5 files)
- structured-subagent.ts, output-manager.ts, spawn-policy.ts
- yield-assembly.ts, repair-args.ts

### Schema 系统 — vendor/omp/schema/ (13 files，已用 7 个)
- types.ts, equality.ts, dereference.ts, json-schema-validator.ts ✅ 已用
- meta-validator.ts, stamps.ts ✅ 已用
- adapt.ts, draft.ts, compatibility.ts, normalize.ts, fields.ts
- spill.ts, strict-tool-validation.ts, typescript.ts, wire.ts, zod-decontaminate.ts

## 更新流程

```bash
# 1. 覆盖 vendor
cp -r /path/to/new-omp/src/ vendor/omp/

# 2. 对照此文档重新应用 Bun→Node 替换
# 3. 检查 build:main
```
