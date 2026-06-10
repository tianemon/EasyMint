EM Project Graph + Focus Engine

Architecture Design & Technical Specification

Version 0.1

⸻

一、目标

问题定义

当前 Agent 在大型项目中的主要问题：

1. 无法建立项目整体认知
2. 无法快速定位相关代码
3. 修改代码时无法分析影响范围
4. 长期任务过程中容易丢失上下文
5. 重复读取大量无关代码
6. Token消耗随项目规模线性增长
7. Builder缺乏项目导航能力

⸻

目标

构建一套项目认知系统。

让 Agent 从：

全文搜索
+
文件阅读

转变为：

图谱导航
+
动态聚焦

⸻

核心原则

Project Graph
负责组织项目知识
Focus Engine
负责选择当前需要的知识
LLM
负责推理与生成

⸻

二、系统架构

                     User Request
                           │
                           ▼
                ┌─────────────────┐
                │   Task Parser   │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  Focus Engine   │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Project Graph   │
                └────────┬────────┘
                         │
                         ▼
                Focus Context
                         │
                         ▼
                ┌─────────────────┐
                │ Context Builder │
                └────────┬────────┘
                         │
                         ▼
                     Builder

⸻

三、Project Graph

⸻

设计目标

构建项目结构认知层。

让 Agent 具备：

项目导航能力
依赖分析能力
影响分析能力
模块理解能力

⸻

四、Graph结构

⸻

Node

Project

id: project_em
type: project
name: EasyMint

⸻

Module

id: module_auth
type: module
name: Auth

⸻

File

id: file_auth_service
type: file
path: src/auth/service.ts

⸻

Class

id: class_auth_service
type: class
name: AuthService

⸻

Function

id: fn_login
type: function
name: login

⸻

Edge

contains

Project
 ↓
Module
 ↓
File
 ↓
Class
 ↓
Function

⸻

imports

AuthService
 ↓
imports
 ↓
JwtService

⸻

calls

login()
 ↓
calls
 ↓
verifyPassword()

⸻

depends_on

AuthModule
 ↓
depends_on
 ↓
UserModule

⸻

五、Graph构建器

技术栈

Tree-Sitter
SQLite
TypeScript

⸻

数据流

Source Code
↓
Tree-Sitter
↓
AST
↓
Symbol Extractor
↓
Graph Builder
↓
SQLite

⸻

六、数据库设计

⸻

nodes

CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    type TEXT,
    name TEXT,
    path TEXT,
    summary TEXT
);

⸻

edges

CREATE TABLE edges (
    id TEXT PRIMARY KEY,
    source TEXT,
    target TEXT,
    relation TEXT
);

⸻

symbols

CREATE TABLE symbols (
    id TEXT PRIMARY KEY,
    file_id TEXT,
    symbol_type TEXT,
    name TEXT
);

⸻

七、Graph API

⸻

查询模块

findModule()

⸻

查询文件

findFile()

⸻

查询函数

findFunction()

⸻

查询调用链

findCallers()

返回：

[
  "LoginController",
  "Gateway"
]

⸻

查询依赖

findDependencies()

⸻

查询影响范围

findImpact()

返回：

{
  "modules": [],
  "files": [],
  "functions": []
}

⸻

八、Focus Graph

⸻

设计原则

Focus Graph 不是单一焦点，而是多层次的认知图谱。

命名与 Project Graph 对称：
  - Project Graph = 项目知识图谱（静态，全量）
  - Focus Graph  = 当前任务视角下的认知图谱（动态，聚焦）

⸻

为什么不是 Focus Zone

复杂任务天然是多焦点的。例如"增加组织级权限管理"涉及
Auth、Permission、Organization、Frontend、Gateway、Database
六个区域——不存在单一中心。

Focus Zone 暗示"一个区域"，Focus Graph 承认"多个区域，彼此关联"。

⸻

Focus Graph 结构

```
Focus Graph
├── Primary Focus    (P0, 60%)  当前主工作区
├── Secondary Focus  (P1, 25%)  关联工作区
├── Dependency Focus (P2, 10%)  依赖工作区
└── Background Focus (P3, 5%)   项目全局信息
```

⸻

一个实际例子

任务：增加组织级权限管理

Focus Graph：
  Primary:
    OrganizationModule
    PermissionModule
  Secondary:
    AuthModule
    UserModule
  Dependency:
    Database
    Redis
  Background:
    Architecture Summary
    Decision Summary

⸻

进化路线

V0.1  — 只有 Primary Focus，单焦点
V0.2  — 增加 Secondary + Dependency
V0.3  — 支持 Parallel Focus（Multi-Agent，每个 Agent 一个 Focus）
V1.0  — 完整 Focus Graph + Supervisor 协调

⸻

数据结构

// 不是这样：
interface FocusZone {
    nodes: Node[]
}

// 而是这样：
interface FocusGraph {
    primary: FocusGroup[]
    secondary: FocusGroup[]
    dependency: FocusGroup[]
    background: FocusGroup[]
}

interface FocusGroup {
    domain: string
    weight: number
    nodes: GraphNode[]
}

从 V0.1 开始就用这个接口——初期 primary 之外为空数组，
后续扩展不加字段，只加数据。

⸻

九、Focus 生成流程

⸻

Step1 — Task Parser

输入：自然语言任务（如「增加组织级权限管理」）

LLM 解析 → 输出：
{
  "domains": ["Organization", "Permission"],
  "intent": "Create",
  "primary": "Organization"
}

⸻

Step2 — Graph 定位

对每个 domain 在 Project Graph 中定位入口节点：
  Organization → OrganizationModule, OrgService
  Permission   → PermissionModule, PermissionService

⸻

Step3 — 扩散

从入口节点沿 contains / calls / imports / depends_on 向外扩散 1 层：
  AuthModule (Permission 依赖 Auth)
  UserModule (Organization 包含 User)
  Database  (PermissionService 写入 DB)
  Redis     (AuthService 读写 Session)

⸻

Step4 — 分层分配

按扩散深度和关系类型分配到四个 group：
  depth=0, 直接相关 → Primary
  depth=1, imports/calls → Secondary
  depth=1, depends_on → Dependency
  项目架构摘要 → Background

⸻

Step5 — 输出 Focus Graph

{
  "primary":    [{ domain: "Organization", weight: 0.6, nodes: [...] }],
  "secondary":  [{ domain: "Permission", weight: 0.25, nodes: [...] }],
  "dependency": [{ domain: "Auth", weight: 0.1, nodes: [...] }],
  "background": [{ domain: "Summary", weight: 0.05, nodes: [...] }]
}

⸻

十一、Impact Analysis

⸻

目标

回答：

修改这里会影响哪里

⸻

查询逻辑

Node
↓
calls
imports
depends_on
↓
递归扩散

⸻

例如：

login()

影响：

AuthService
LoginController
Gateway
UserSession

⸻

API

analyzeImpact()

⸻

返回：

{
  "risk": "medium",
  "affected_modules": [],
  "affected_files": [],
  "affected_functions": []
}

⸻

十二、Context Builder

⸻

输入

User Request
Focus Graph
Impact Analysis

⸻

输出

Current Task: 增加组织级权限管理

Focus Graph:
  Primary: OrganizationModule, PermissionService
  Secondary: AuthModule, UserModule
  Dependency: Database, Redis
  Background: Architecture Summary

Impact:
  - Gateway (Auth 入口变更)
  - Session (Redis Key 结构变更)

Constraints:
  - Do not modify JWT architecture
  - Keep backward compatibility with existing UserModule API

⸻

十三、Builder接入方案

Builder执行前：

focus = FocusEngine.build()
impact = Graph.analyzeImpact()
context = ContextBuilder.build()

⸻

注入：

System Prompt
+
Project Context
+
User Task

⸻

十四、Evaluator接入方案

Evaluator新增：

Architecture Check

验证：

是否违反模块边界
是否新增循环依赖
是否破坏现有调用链

⸻

Impact Validation

验证：

影响范围是否覆盖测试

⸻

十五、性能优化

⸻

缓存

缓存：

Focus Graph
Impact Analysis
Graph Query

⸻

增量更新

仅重新解析：

修改文件

⸻

避免：

重新索引整个项目

⸻

十六、V0.1开发范围

必做

Tree-Sitter索引
SQLite图谱
Module/File/Function节点
contains关系
imports关系
calls关系
findImpact()
Focus Engine
Context Builder

⸻

不做

Memory Engine
Decision Graph
Requirement Graph
Governance Layer
Multi-Agent
Neo4j
向量数据库

⸻

成功标准

当 Builder 处理一个中大型项目任务时：

上下文长度下降 >50%
文件读取次数下降 >60%
任务完成率提升 >20%
返工率下降 >30%
影响范围分析准确率 >80%

则证明：

Project Graph
+
Focus Engine

路线成立。

此后再进入 V0.2：

Decision Graph
Requirement Graph
Architecture Graph

构建完整的 Project Cognitive Graph。