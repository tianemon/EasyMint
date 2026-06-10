下面是一份面向 EasyMint（EM）未来 2~3 年演进的可直接落地架构设计文档，目标不是 AI 编程工具，而是：

Project Cognitive Runtime（项目认知运行时）

⸻

EM Project Cognitive Runtime

Version

EM Architecture v1.0

⸻

一、总体目标

构建一个能够支持长期软件工程项目的 Agent Runtime。

解决以下问题：

1. Agent无法理解大型项目
2. Agent容易遗忘历史决策
3. Agent无法分析修改影响范围
4. Agent无法长期保持架构一致性
5. Agent无法稳定执行复杂任务链
6. Agent缺乏工程治理能力

最终形成：

Project Cognitive Runtime

而非：

AI Coding Tool

⸻

二、总体架构

┌─────────────────────────────┐
│           User              │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│           Mint              │
│      Governance Layer       │
└─────────────┬───────────────┘
              │
 ┌────────────┼────────────┐
 ▼            ▼            ▼
Memory   ProjectGraph   TaskSystem
 └────────────┼────────────┘
              ▼
      Focus Engine
              ▼
     Context Builder
              ▼
           Builder
              ▼
         Evaluator
              ▼
     Verification Engine

⸻

三、核心模块

⸻

1 Project Graph

职责

构建项目认知图谱。

保存：

项目结构
代码结构
需求
架构
决策
任务
Bug
测试
历史记录

⸻

节点类型

Project
Domain
Module
Component
File
Class
Function
Requirement
Architecture
Decision
Task
Bug
Test
Document
Session

⸻

边类型

contains
implements
depends_on
calls
imports
extends
implements_interface
related_to
caused_by
tested_by
generated_from
assigned_to

⸻

示例

Requirement#12
    │
implements
    ▼
AuthModule
    │
contains
    ▼
AuthService
    │
contains
    ▼
login()

⸻

2 Memory Engine

职责

保存长期工程记忆。

⸻

Memory分类

Architecture Memory

{
  "id": "arch_001",
  "title": "JWT Authentication",
  "reason": "Stateless Auth",
  "created_at": "2026-01-01"
}

⸻

Decision Memory

{
  "id": "decision_001",
  "decision": "Use Zustand",
  "reason": "Small Project",
  "status": "active"
}

⸻

Task Memory

{
  "task_id": "task_22",
  "summary": "Implement Login Captcha",
  "status": "completed"
}

⸻

Failure Memory

{
  "issue": "Infinite Render",
  "solution": "Move state update to useEffect"
}

⸻

Skill Memory

{
  "skill": "React CRUD",
  "success_rate": 0.92
}

⸻

3 Code Intelligence Engine

职责

构建代码认知层。

替代：

grep
全文搜索
读取整个项目

⸻

技术方案

Tree-Sitter
+
SCIP
+
SQLite

⸻

构建流程

Source Code
↓
Tree-Sitter
↓
AST
↓
Symbol Extractor
↓
Code Graph
↓
SQLite

⸻

提供能力

findSymbol()
findDefinition()
findReferences()
findCallers()
findDependencies()
findImports()
findExports()
findImplementations()

⸻

4 Task System

职责

管理任务生命周期。

⸻

Task状态

Pending
Planning
InProgress
Review
Completed
Failed

⸻

Task结构

{
  "task_id": "task_32",
  "title": "Add Login Captcha",
  "priority": "high",
  "related_module": "Auth",
  "related_requirement": "req_12"
}

⸻

5 Focus Engine

职责

动态构建 Agent 当前工作区。

⸻

输入

当前任务
+
Project Graph
+
Memory

⸻

输出

Focus Zone

⸻

Focus Zone结构

Level 1

核心节点

AuthService
LoginController
CaptchaService

⸻

Level 2

关联节点

Redis
JWT
Permission

⸻

Level 3

领域节点

User Domain

⸻

输出比例

70% Focus
20% Related
10% Project Summary

⸻

6 Context Builder

职责

构建最终上下文。

⸻

输入

Project Graph
Memory
Task
Focus Zone

⸻

输出

Project Summary
Current Task
Related Requirement
Related Decision
Focus Zone
Impact Analysis
Execution Constraints

⸻

注入Builder

System Prompt
+
Context Package
+
User Request

⸻

7 Builder Agent

职责

执行开发任务。

⸻

能力

编写代码
重构代码
生成测试
生成文档
修复Bug

⸻

Builder禁止行为

自行修改架构
删除核心模块
修改关键决策

⸻

必须通过Governance

⸻

8 Evaluator Agent

职责

验证Builder结果。

⸻

检查项

Build
Lint
TypeCheck
Unit Test
Integration Test
E2E
Coverage
Architecture Consistency

⸻

输出

{
  "score": 91,
  "passed": true,
  "issues": []
}

⸻

9 Verification Engine

职责

自动验证结果。

⸻

Pipeline

Build
↓
Lint
↓
TypeCheck
↓
Test
↓
Coverage
↓
Security Scan
↓
Performance Scan

⸻

四、Governance Layer

⸻

1 Autonomy Level

Level 0

Manual

用户控制全部

⸻

Level 1

Assist

Agent建议
用户执行

⸻

Level 2

Semi-Auto

Agent执行
用户审核

⸻

Level 3

Autonomous

Agent自主执行
重要操作审批

⸻

Level 4

Project Auto

Agent管理整个项目
关键决策审批

⸻

Level 5

Full Runtime

Agent长期运行
用户只负责治理

⸻

2 Escalation Engine

触发条件

架构修改
数据库迁移
API Breaking Change
删除模块
安全相关修改

⸻

输出

{
  "risk": "high",
  "reason": "Modify Auth Architecture",
  "affected_modules": [
    "Auth",
    "Gateway"
  ]
}

⸻

五、数据库设计

project_graph.db

⸻

nodes

CREATE TABLE nodes(
  id TEXT PRIMARY KEY,
  type TEXT,
  name TEXT,
  summary TEXT,
  metadata JSON
);

⸻

edges

CREATE TABLE edges(
  id TEXT PRIMARY KEY,
  source_id TEXT,
  target_id TEXT,
  relation TEXT
);

⸻

decisions

CREATE TABLE decisions(
  id TEXT PRIMARY KEY,
  title TEXT,
  reason TEXT,
  created_at TEXT,
  status TEXT
);

⸻

tasks

CREATE TABLE tasks(
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT,
  priority TEXT
);

⸻

memories

CREATE TABLE memories(
  id TEXT PRIMARY KEY,
  type TEXT,
  content TEXT,
  created_at TEXT
);

⸻

六、EM集成方案

NewProject

生成：

Requirement Graph
Architecture Graph
Initial Task Graph

⸻

Builder执行前

调用：

generateFocusZone()
buildContext()
loadDecisions()
loadArchitecture()

⸻

Builder执行后

调用：

impactAnalysis()
verification()
architectureCheck()

⸻

Evaluator完成后

更新：

Project Graph
Task Graph
Memory Engine

⸻

七、长期演进路线

Phase 1

当前

Builder
Evaluator
Task System

⸻

Phase 2

Project Graph
Code Intelligence
Impact Analysis

⸻

Phase 3

Memory Engine
Decision Memory
Architecture Memory

⸻

Phase 4

Focus Engine
Context Builder
Governance Layer

⸻

Phase 5

Full Project Cognitive Runtime

⸻

最终形态

EasyMint
≠ AI Coding Tool
≠ Cursor Clone
≠ Agent Framework
=
Project Cognitive Runtime
通过：
Project Graph
+
Memory Engine
+
Focus Engine
+
Governance Layer
让Agent获得长期项目认知能力、
动态上下文聚焦能力、
影响分析能力、
工程治理能力。