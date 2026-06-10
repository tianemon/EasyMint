Focus Engine Design

Version 0.2

⸻

一、定位

Focus Engine 是 CodeGraph 的上层。

CodeGraph 做索引和查询，Focus Engine 做聚焦和上下文组织。

不重新实现 Project Graph。

⸻

二、系统关系

Builder / Evaluator
    │
    ▼
Focus Engine
├─ Task Parser
├─ Focus Builder
└─ Context Builder
    │
    ▼ 委托给 CodeGraph
CodeGraph
├─ search  callers  callees  impact
└─ SQLite 图谱

⸻

三、Focus Graph

不是单一的 Focus Zone——复杂任务天然多焦点。

Focus Graph
├── Primary Focus    P0  60%  主工作区
├── Secondary Focus  P1  25%  关联工作区
├── Dependency Focus P2  10%  依赖工作区
└── Background Focus P3   5%  项目全局

⸻

四、生成流程

Step1 — Task Parser

输入

增加组织级权限管理

输出

{
  "domains": ["Organization", "Permission"],
  "intent": "create",
  "keywords": ["组织", "权限", "角色"]
}

⸻

Step2 — 定位

对每个 domain 调 codegraph_search

Organization → OrganizationModule  OrganizationService
Permission   → PermissionModule   PermissionService

⸻

Step3 — 扩散

调 codegraph_callers + codegraph_impact + codegraph_callees

扩散 1 层：

OrganizationService → UserService       contains
PermissionService   → AuthService        imports
AuthService        → RedisSession       calls
PermissionService  → Database            calls

⸻

Step4 — 分层

Primary
├── OrganizationModule
└── PermissionModule

Secondary
├── AuthService       ← imports from PermissionService
└── UserService       ← contained by Organization

Dependency
├── Database          ← PermissionService calls
└── RedisSession      ← AuthService calls

Background
└── Project Summary   ← React + Node.js, JWT, PostgreSQL

分配规则：
  Primary    直接命中 + keywords 匹配
  Secondary  imports/calls 邻居  1 层扩散
  Dependency depends_on / 被影响  间接依赖
  Background 架构摘要  跨任务复用

⸻

Step5 — 摘要

LLM 对每个节点生成一句话描述

OrganizationService → 管理组织架构的增删改查
PermissionService  → 权限校验和角色管理

缓存到 CodeGraph nodes.summary

⸻

Step6 — Focus Graph

简单任务（V0.1）

{
  "primary": [
    {
      "domain": "Auth",
      "weight": 1.0,
      "nodes": ["AuthService", "LoginController"],
      "summary": "修复登录 BUG"
    }
  ],
  "secondary": [],
  "dependency": [],
  "background": []
}

⸻

复杂任务（V0.2+）

{
  "primary": [
    {
      "domain": "Organization",
      "weight": 0.6,
      "nodes": ["OrganizationModule", "OrganizationService"],
      "summary": "用户要求增加组织管理功能"
    }
  ],
  "secondary": [
    {
      "domain": "Permission",
      "weight": 0.25,
      "nodes": ["PermissionService", "AuthService"],
      "summary": "权限管理依赖认证模块"
    }
  ],
  "dependency": [
    {
      "domain": "Infrastructure",
      "weight": 0.1,
      "nodes": ["Database", "RedisSession"],
      "summary": "底层存储，变更需验证兼容性"
    }
  ],
  "background": [
    {
      "domain": "Project",
      "weight": 0.05,
      "summary": "React + Node.js，JWT 认证，PostgreSQL"
    }
  ]
}

⸻

五、Context Builder

输入

User Request
Focus Graph
Impact Analysis

输出

System Prompt 上下文块

当前任务: 增加组织权限管理

Primary Focus:
  - OrganizationService (管理组织架构的增删改查)

Secondary Focus:
  - PermissionService (权限校验和角色管理)

Dependency:
  - Database  Redis

影响范围:
  - AuthService 变更影响 Gateway 入口

约束:
  - 不修改 JWT 签发逻辑

⸻

六、接入方式

Mint 调 Task(builder) 前：

1. 调 focus_context 生成上下文
2. Task prompt = 任务描述 + 上下文 + 约束
3. Builder 系统提示词已包含 Focus Graph

⸻

七、MCP Tools

focus_build    输入 task_description  project_path → FocusGraph JSON
focus_context  输入 task_description  project_path → 系统提示文本
focus_summarize 输入 node_id → 节点 LLM 摘要

⸻

八、V0.1 范围

Task Parser  单 domain
Primary Focus  生成
Context Builder  只输出 primary

secondary  dependency  background 为空数组

⸻

九、进化

V0.2  + Secondary + Dependency
V0.3  Parallel Focus  Multi-Agent 每人一个 Focus
V1.0  完整 Focus Graph + Supervisor