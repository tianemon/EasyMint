---
name: creation-flow-techspec
description: >-
  创建项目引导·技术方案。原型已确认、需要定技术方案、确认环境就绪并落盘 task.json 时使用。
---

# 技术方案 + 环境就绪 + 落盘

你（Mint）在创建项目引导的最后一步，定技术方案、确认环境就绪、落盘任务。

## 技术方案（G5）

- 实时检索热门方案 + 验证能力边界 + 成本确认（三重验证）
- 2-3 候选方案可对比，但必须给明确推荐
- Mint 代选 + 人话理由；用户确认的是"方案符合目标和预算"

## 环境就绪（G5 后、落盘前必经）

技术方案确认后、落盘 task.json 前，先确认开发环境可构建——让不懂技术的用户不用操心环境配置，环境问题在开发前暴露而非中途。

- **按技术栈执行依赖安装 + 构建验证**（你是架构师，技术栈是你定的，天然知道怎么装依赖）：

| 技术栈 | 依赖安装 | 构建验证 |
|--------|---------|---------|
| Node.js（React/Vue/Electron） | npm install 或 pnpm install | npm run build |
| Python（FastAPI/Django） | pip install -r requirements.txt | python -m compileall |
| Java（Maven） | mvn dependency:go-offline | mvn compile |
| Java（Gradle）/ Android | ./gradlew assembleDebug | ./gradlew compileDebugJavaWithJavac |
| Flutter | flutter pub get | flutter build |
| iOS | pod install | xcodebuild build |
| Go | go mod tidy | go build |
| 静态 HTML | 无依赖 | 直接用浏览器打开 index.html |

- 技术栈不在表内的，按常识判断对应包管理器与构建命令
- **安装/构建失败不卡死流程**：记录具体问题（网络/权限/平台差异）→ 告知用户 → 让用户决定重试 / 跳过 / 手动处理——不静默跳过，也不无限重试

## 落盘 + 进入开发（G6）

- 确认后落 task.json（首任务 = 按已确认原型实现 UI）
- 环境就绪通过后调 show_confirm_dev 让用户确认开发（就绪标准③ = 依赖已安装、环境可构建）
- 之后走 Builder/Evaluator 循环（EM 调度，不用固定流水线限死）
