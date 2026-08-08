---
name: project-migration
description: >-
  Cross-device project/session migration. Triggers when the user explicitly
  wants to move a project to another device: "迁移项目", "传输项目", "搬到另一台电脑",
  "换电脑继续开发", "把项目传到 mac/win", "转到这台电脑开发". CRITICAL intent check:
  "同步项目" is ambiguous — first check whether it's a git scenario (git push/pull/
  remote) via git status/remote; if so, suggest git instead of migration. Do NOT
  trigger on pure conversation, read-only research, or vague remarks like
  "迁移是什么意思".
---

# Project Migration — 跨设备项目迁移

Move a project (code + latest session) to another device over LAN. The user
triggers, YOU orchestrate (devices → pair → manifest → transfer), the target
device's system layer restores everything automatically.

## Instructions

### Step 1: Confirm intent (mandatory, do not skip)

- User says **"迁移/传输项目"** → migration intent, proceed.
- User says **"同步项目"** → CHECK FIRST: run `git remote -v` / `git status`.
  - If a git remote exists and the context is push/pull/sync → **do NOT migrate**;
    tell the user this is a git sync scenario and help with git instead.
  - If the user means "sync my project to my other computer" → proceed as migration.
- Anything else (questions, chat, "迁移是什么") → do NOT trigger, answer normally.

> **Validation gate:** Did you confirm the intent is cross-device migration and
> not git sync / chat? If unsure, ask the user one clarifying question.

### Step 2: List devices and let the user pick the target

Call `list_devices`. Present the result:

- **已配对设备**（含在线/离线）→ ask the user which device is the target.
- If the target appears only under 可用设备 (not yet paired) → go to Step 3.
- If no devices at all → tell the user: "需要两台设备都开启「可被发现」并处于同一局域网，才能迁移。"

Wait for the user to name the target device.

### Step 3: Ensure pairing

- Target device is 已配对且在线 → skip to Step 4.
- Target device is 已配对但离线 → tell the user it's offline; suggest starting EM on that device, then retry.
- Target device is not paired → **ask the user first** ("目标设备还没配对，我会发起配对请求，对方需要确认弹窗"), then call `request_pair` with the deviceId. Wait for the user to confirm the pairing dialog was accepted (they can check 设备互联 panel). After pairing, re-run `list_devices` to confirm online.

> Device management tools: `toggle_discoverable` (open/close discoverability — ask the
> other device's user to enable it if they are not visible), `unpair_device` (remove a
> pairing), `rename_device` (rename this device). Use them only when the user asks.

### Step 5 (after receipt): report the result

When the target device finishes restoring, a system message is injected into
this session ("迁移完成…" or "迁移失败…"). Relay it to the user and suggest
next steps (e.g. continue development on the target device).

### Step 4: Prepare the migration manifest

Call `prepare_migration` with the project path. The tool returns a file list
(excluding `.git` / `node_modules` / `dist` / `build` / `.easymint` / caches —
you may pass `include`/`exclude` to adjust).

**Present the manifest to the user and wait for explicit confirmation:**
file count, total size, and the excluded categories. If the user wants to add
or remove files, re-run `prepare_migration` with adjusted `include`/`exclude`.

> **Why confirm:** the manifest decides what the other device receives. AI
> judgment can be wrong — the user is the gate.

### Step 5: Start the transfer

Call `start_transfer` with the confirmed `files` (from Step 4's result), the
`deviceId`, and the `projectPath`. Tell the user the transfer has started.

**Your responsibility ends at "transfer complete"** — the target device's
system layer will unpack, restore the session, notify that device's Mint, and
send back a receipt. When the receipt arrives (the target's Mint/system will
notify), tell the user: "已在 <device> 上恢复完成。"

### Step 6: After migration (target device's Mint only)

If THIS device received a migration, the system injects a message with the new
path and environment notes. Follow it: re-read the project structure, rebuild
git (`git init`, re-add remote if any), and align task progress with task.json.
