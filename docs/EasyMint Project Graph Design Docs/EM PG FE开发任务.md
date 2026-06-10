基于前面的拆解，我建议你不要直接把任务扔给 Builder。

先建立一份真正的开发 Backlog。

按照依赖关系，EM 的开发任务应该这样排。

⸻

Sprint 1：Project Graph MVP

目标：

能够索引项目
能够查询函数
能够查询调用关系

这是整个系统的根基。

⸻

EPIC-001 Code Indexing

TASK-001

Language Detector

验收：

支持：
.ts
.tsx
.js
.jsx

工期：

0.5天

⸻

TASK-002

Parser Provider

验收：

根据语言返回Tree-Sitter Parser

工期：

0.5天

⸻

TASK-003

Source Loader

验收：

读取项目文件

工期：

0.5天

⸻

TASK-004

AST Parser

验收：

输入源码
输出AST

工期：

1天

⸻

TASK-005

AST Repository

验收：

存储项目所有AST

工期：

1天

⸻

TASK-006

AST Test Suite

验收：

测试样例通过

工期：

0.5天

⸻

Sprint 2：Symbol Graph

目标：

项目导航能力

⸻

EPIC-002 Symbol Extractor

TASK-007

Module Extractor

提取：

Module

⸻

TASK-008

File Extractor

提取：

File

⸻

TASK-009

Class Extractor

提取：

Class

⸻

TASK-010

Function Extractor

提取：

Function

⸻

TASK-011

Symbol Storage

存入 SQLite

⸻

TASK-012

Graph Query API

实现：

findModule()
findFile()
findFunction()

⸻

Sprint 3：Relation Graph

目标：

项目结构关系

⸻

EPIC-003 Relation Extractor

TASK-013

Import Extractor

生成：

imports

⸻

TASK-014

Export Extractor

生成：

exports

⸻

TASK-015

Call Extractor

生成：

calls

⸻

TASK-016

Dependency Extractor

生成：

depends_on

⸻

TASK-017

Relation Storage

写入：

edges

⸻

TASK-018

Relation Query API

实现：

findCallers()
findDependencies()

⸻

Sprint 4：Impact Analysis

目标：

回答：
修改这里会影响哪里

⸻

EPIC-004 Impact Engine

TASK-019

Function Impact

⸻

TASK-020

File Impact

⸻

TASK-021

Module Impact

⸻

TASK-022

Risk Analyzer

输出：

{
  "risk":"low"
}

⸻

TASK-023

Impact API

实现：

analyzeImpact()

⸻

Sprint 5：Focus Engine

目标：

构建Focus Zone

⸻

EPIC-005 Focus Engine

TASK-024

Task Parser

输入：

自然语言任务

⸻

TASK-025

Node Locator

定位：

目标节点

⸻

TASK-026

Related Node Finder

寻找：

关联节点

⸻

TASK-027

Core Zone Builder

⸻

TASK-028

Related Zone Builder

⸻

TASK-029

Focus Zone Builder

输出：

{
  core:[],
  related:[]
}

⸻

Sprint 6：Context Builder

目标：

让Builder真正受益

⸻

EPIC-006 Context Builder

TASK-030

Project Summary Generator

⸻

TASK-031

Impact Context Generator

⸻

TASK-032

Focus Context Generator

⸻

TASK-033

Context Assembler

输出：

Task:
Focus:
Impact:
Constraints:

⸻

Sprint 7：EM Integration

目标：

接入现有Builder

⸻

EPIC-007 Integration

TASK-034

Builder Hook

⸻

TASK-035

Builder Context Injection

⸻

TASK-036

Evaluator Hook

⸻

TASK-037

Architecture Validator

⸻

TASK-038

Impact Validator

⸻

里程碑

M1

完成：

TASK-001 ~ TASK-012

成果：

项目导航

Agent可以知道：

这个函数在哪
这个类在哪
这个模块在哪

⸻

M2

完成：

TASK-013 ~ TASK-023

成果：

影响分析

Agent可以知道：

改这里会影响哪里

⸻

M3

完成：

TASK-024 ~ TASK-033

成果：

Focus Engine

Agent开始具备：

动态项目聚焦

⸻

M4

完成：

TASK-034 ~ TASK-038

成果：

Builder增强版

⸻

如果是我来做 EM，我会把 TASK-001 到 TASK-018 作为第一阶段目标。

因为到这里，你实际上已经拥有了：

Project Graph v0.1

而这正是整个 Project Cognitive Runtime 的地基。按照 WBS 的思想，先交付最小可用能力，再向上叠加 Focus Engine 和 Context Builder，会比一次性做完整系统风险小得多。 ￼