我读完了你的 AORD 文档。

我发现一件事：

你现在给出的 Project Graph + Focus Engine 实际上已经不是一个功能需求，而是一个基础设施系统（Infrastructure）。

按照 AORD 的原则，不能直接拆：

Project Graph
Focus Engine

因为这属于技术实现。

AORD 要先回答：

Agent最终要完成什么目标？

⸻

0 项目目标

用户目标

让Agent能够理解大型项目
让Agent能够快速定位相关代码
让Agent能够分析影响范围
让Agent能够在长期项目中保持稳定上下文
降低Token消耗
提高Builder任务完成率

⸻

1 用户工作流

Builder工作流

接收任务
↓
理解任务
↓
定位相关模块
↓
定位相关文件
↓
定位相关函数
↓
分析影响范围
↓
构建工作上下文
↓
执行修改
↓
验证结果

⸻

当前EM的问题：

接收任务
↓
直接开始搜索代码
↓
反复读取文件
↓
修改
↓
出现遗漏

⸻

目标工作流：

接收任务
↓
Project Graph导航
↓
Focus Engine聚焦
↓
Builder执行
↓
Evaluator验证

⸻

2 功能树

按照依赖顺序拆解

⸻

1.0 Code Indexing System

项目索引系统

⸻

1.1 项目扫描

输入

项目目录

输出

文件列表

⸻

1.2 AST解析

输入

源码文件

处理

Tree-Sitter

输出

AST

⸻

1.3 Symbol提取

输入

AST

输出

Module
File
Class
Function

⸻

1.4 Import关系提取

输出

imports

⸻

1.5 Call关系提取

输出

calls

⸻

1.6 Dependency关系提取

输出

depends_on

⸻

2.0 Project Graph

依赖：

Code Indexing System

⸻

2.1 Graph节点管理

CRUD

Node
Create
Read
Update
Delete

⸻

2.2 Graph关系管理

CRUD

Edge
Create
Read
Update
Delete

⸻

2.3 Graph存储

输入

节点
关系

输出

SQLite

⸻

2.4 Graph查询

⸻

2.4.1 查询模块

findModule()

⸻

2.4.2 查询文件

findFile()

⸻

2.4.3 查询函数

findFunction()

⸻

2.4.4 查询调用链

findCallers()

⸻

2.4.5 查询依赖

findDependencies()

⸻

3.0 Impact Analysis

依赖：

Project Graph

⸻

3.1 影响范围查询

输入

Function

输出

受影响Function

⸻

3.2 文件影响分析

输入

File

输出

受影响File

⸻

3.3 模块影响分析

输入

Module

输出

受影响Module

⸻

3.4 风险等级评估

状态

Low
Medium
High

⸻

4.0 Task Understanding

依赖：

Project Graph

⸻

4.1 用户任务解析

输入

自然语言任务

输出

{
  "domain":"",
  "intent":"",
  "target":""
}

⸻

4.2 目标定位

输入

任务

输出

Graph Node

⸻

4.3 相关节点发现

输出

Related Nodes

⸻

5.0 Focus Engine

依赖：

Task Understanding
Impact Analysis

⸻

5.1 Core Zone生成

输入

目标节点

输出

核心节点

⸻

5.2 Related Zone生成

输入

核心节点

输出

关联节点

⸻

5.3 Focus Zone构建

输出

{
  "core":[],
  "related":[],
  "summary":[]
}

⸻

5.4 Focus缓存

避免重复计算

⸻

6.0 Context Builder

依赖：

Focus Engine

⸻

6.1 项目摘要生成

输出

Project Summary

⸻

6.2 Focus上下文生成

输出

Focus Context

⸻

6.3 Impact上下文生成

输出

Impact Context

⸻

6.4 Builder Context Package

输出

Task
Focus
Impact
Constraints

⸻

7.0 Builder Integration

依赖：

Context Builder

⸻

7.1 Builder预处理

执行

Generate Focus Zone

⸻

7.2 Builder上下文注入

执行

Inject Context

⸻

7.3 Builder结果回传

输出

修改结果

⸻

8.0 Evaluator Integration

依赖：

Impact Analysis

⸻

8.1 影响范围测试

验证

影响区域是否覆盖测试

⸻

8.2 架构一致性检查

验证

模块边界
依赖关系
循环引用

⸻

模块依赖图

这是实际开发顺序。

1 Code Indexing System
        │
        ▼
2 Project Graph
        │
        ▼
3 Impact Analysis
        │
        ▼
4 Task Understanding
        │
        ▼
5 Focus Engine
        │
        ▼
6 Context Builder
        │
        ▼
7 Builder Integration
        │
        ▼
8 Evaluator Integration

⸻

如果按 MVP 来做，我甚至会继续压缩成：

Phase 1
1.1 AST解析
1.2 Symbol提取
2.1 Graph存储
2.4 Graph查询
-----------------
Phase 2
3.1 Impact Analysis
4.1 Task Understanding
5.1 Focus Engine
-----------------
Phase 3
6 Context Builder
7 Builder Integration
-----------------
Phase 4
8 Evaluator Integration

这样你接下来就可以直接进入：

￼ AORD 第二层拆解——把 1.1 AST解析 开始继续拆成可执行开发任务（Task 1.1.1、1.1.2、1.1.3…），而不是继续停留在架构讨论阶段。现在最需要的是从架构进入工程实施。

很好。

从 AORD 的角度看：

1.0 Code Indexing System
 ├─ 1.1 AST解析
 ├─ 1.2 Symbol提取
 ├─ 1.3 Import提取
 ├─ 1.4 Call提取

其中：

1.1 AST解析

实际上已经接近技术模块了。

继续往下拆，需要拆到：

开发任务（Developer Task）

即：

一个Builder可以独立完成
一个PR可以完成
一个测试可以验证

的粒度。

⸻

1.1 AST解析

目标

输入：

源码文件

输出：

统一AST对象

供后续：

Symbol Extractor
Import Extractor
Call Extractor

使用。

⸻

1.1.1 Parser Provider

功能

管理不同语言Parser。

⸻

输入：

typescript
javascript
python
go

⸻

输出：

对应Tree-Sitter Parser

⸻

接口

getParser(language)

⸻

验收标准

给定语言
返回正确Parser实例

⸻

依赖

无

⸻

1.1.2 Language Detector

功能

识别源码语言。

⸻

输入

file.ts
file.js
file.py
file.go

⸻

输出

typescript
javascript
python
go

⸻

接口

detectLanguage(path)

⸻

验收标准

识别准确率100%

⸻

依赖

无

⸻

1.1.3 Source Loader

功能

读取源码文件。

⸻

输入

文件路径

⸻

输出

源码字符串

⸻

接口

loadSource(path)

⸻

验收标准

成功读取源码

⸻

依赖

无

⸻

1.1.4 AST Parser

功能

解析源码生成AST。

⸻

输入

sourceCode

⸻

输出

Tree

⸻

接口

parse(source)

⸻

验收标准

能够解析合法源码
返回AST对象

⸻

依赖

Parser Provider
Source Loader

⸻

1.1.5 Parse Error Handler

功能

处理解析异常。

⸻

场景

语法错误
文件损坏
Parser异常

⸻

输出

{
  "success":false,
  "reason":"..."
}

⸻

接口

handleParseError()

⸻

验收标准

不导致整个索引流程崩溃

⸻

依赖

AST Parser

⸻

1.1.6 AST Normalizer

功能

统一不同语言AST结构。

⸻

原因

Tree-Sitter不同语言：

function_declaration
method_definition
function_definition

名称不同。

⸻

统一成：

Function
Class
Import
Call

⸻

输入

Language AST

⸻

输出

Normalized AST

⸻

接口

normalize(tree)

⸻

验收标准

同一概念生成统一节点类型

⸻

依赖

AST Parser

⸻

1.1.7 AST Cache

功能

缓存AST结果。

⸻

避免：

重复解析文件

⸻

缓存键

filePath
hash

⸻

接口

getAST()
setAST()

⸻

验收标准

重复解析命中缓存

⸻

依赖

AST Parser

⸻

1.1.8 Incremental Parse Manager

功能

增量更新。

⸻

场景

用户修改一个文件

⸻

不要：

重新解析整个项目

⸻

只解析：

当前文件

⸻

接口

updateAST(path)

⸻

验收标准

修改单文件后完成局部更新

⸻

依赖

AST Cache

⸻

1.1.9 AST Repository

功能

统一管理项目所有AST。

⸻

结构

ProjectAST
 ├─ fileA.ast
 ├─ fileB.ast
 ├─ fileC.ast

⸻

接口

getAST(path)
getProjectAST()

⸻

验收标准

能够查询任意文件AST

⸻

依赖

AST Parser
AST Cache

⸻

1.1.10 AST Test Suite

功能

验证解析正确性。

⸻

测试样例

Function
Class
Import
Export
Call

⸻

验证

节点数量
节点类型
节点位置

⸻

验收标准

核心语法解析通过率 >95%

⸻

最终任务树

1.1 AST解析
├─ 1.1.1 Parser Provider
├─ 1.1.2 Language Detector
├─ 1.1.3 Source Loader
├─ 1.1.4 AST Parser
├─ 1.1.5 Parse Error Handler
├─ 1.1.6 AST Normalizer
├─ 1.1.7 AST Cache
├─ 1.1.8 Incremental Parse Manager
├─ 1.1.9 AST Repository
└─ 1.1.10 AST Test Suite

⸻

不过从 EM 当前阶段来看，我会进一步标记优先级：

P0（MVP 必须）

1.1.1 Parser Provider
1.1.2 Language Detector
1.1.3 Source Loader
1.1.4 AST Parser
1.1.10 AST Test Suite

先完成最小可用 AST 管线。

⸻

P1（Project Graph 阶段）

1.1.6 AST Normalizer
1.1.9 AST Repository

为 Symbol 提取和 Graph 构建提供统一输入。

⸻

P2（性能优化阶段）

1.1.7 AST Cache
1.1.8 Incremental Parse Manager
1.1.5 Parse Error Handler

等索引规模变大再做。

这样 Builder 实际第一批任务数量只有 5 个任务，而不是一上来做 10 个模块，开发节奏会更健康。

还没有。

准确地说：

我们刚刚完成的是：

Epic
└── 1.0 Code Indexing System
    └── Feature
        └── 1.1 AST Parsing
            └── Task

但还没到 AORD 真正的终点。

⸻

按照软件工程里的 WBS（工作分解结构）原则，一个任务应该继续拆到：

Task
└── SubTask
    └── Work Package

也就是：

Builder一次能独立完成
Evaluator一次能独立验证

的粒度。 ￼

⸻

例如：

我们刚刚的：

1.1.4 AST Parser

实际上还是一个模块。

对于 Builder 来说太大。

⸻

继续拆：

1.1.4 AST Parser

1.1.4.1 创建 ASTParser 接口

产出：

interface ASTParser {
    parse(source: string): ParseResult;
}

验收：

接口可编译

⸻

1.1.4.2 实现 TypeScript Parser

产出：

TypeScriptParser

验收：

能解析 ts 文件

⸻

1.1.4.3 实现 JavaScript Parser

产出：

JavaScriptParser

验收：

能解析 js 文件

⸻

1.1.4.4 Parser Factory

产出：

ParserFactory

验收：

根据语言返回对应Parser

⸻

1.1.4.5 ParseResult对象

产出：

ParseResult

验收：

统一返回结构

⸻

1.1.4.6 AST节点遍历器

产出：

ASTWalker

验收：

支持DFS遍历

⸻

1.1.4.7 AST节点定位

产出：

getNodeAtPosition()

验收：

根据行列定位节点

⸻

1.1.4.8 Parser单元测试

测试：

function
class
import
export

验收：

通过率 >95%

⸻

这时候才真正进入：

Builder可执行任务

级别。

⸻

实际上对于 EM 来说，完整层级应该是：

Vision
│
├── Epic
│
├── Feature
│
├── Component
│
├── Task
│
├── SubTask
│
└── Work Package

例如：

Project Graph
└── Code Indexing System
    └── AST Parsing
        └── AST Parser
            ├── ASTParser Interface
            ├── TS Parser
            ├── JS Parser
            ├── Parser Factory
            ├── AST Walker
            └── Unit Test

⸻

但我建议你现在不要继续把整个 Project Graph 拆到底。

原因是：

按照 AORD 的思想和大型项目分解经验，先把整个系统拆到 Feature/Component 层，确认架构完整，再挑当前开发的模块继续下钻，否则会出现：

1.1.4.7 已经拆完了
结果发现
1.3 Symbol Extractor
设计推翻了

这种情况。 ￼

所以我建议下一步：

先完成：
1.0 Code Indexing System
2.0 Project Graph
3.0 Impact Analysis
4.0 Task Understanding
5.0 Focus Engine
6.0 Context Builder
全部拆到 Component 层
然后再开始对：
1.0 Code Indexing System
进行第三层拆解
（Work Package级别）

这样更符合你 AORD 的「先保证整体正确，再深入局部实现」原则。