const MOCK_PROJECTS: Project[] = [
  {
    id: "mock-1",
    name: "个人博客",
    path: "~/dev/personal-blog",
    createdAt: "2026-05-15T08:00:00.000Z",
    lastOpenedAt: "2026-05-28T10:30:00.000Z",
    status: "development",
    description: "基于 React + Vite + TypeScript 构建的个人技术博客",
  },
];

const MOCK_FILE_TREE: FileNode[] = [
  { name: "CLAUDE.md", path: "/mock/project/CLAUDE.md", isDirectory: false, modified: true },
  { name: "task.json", path: "/mock/project/task.json", isDirectory: false, modified: true },
  { name: "package.json", path: "/mock/project/package.json", isDirectory: false },
  { name: "tsconfig.json", path: "/mock/project/tsconfig.json", isDirectory: false },
  { name: "index.html", path: "/mock/project/index.html", isDirectory: false },
  {
    name: "src",
    path: "/mock/project/src",
    isDirectory: true,
    children: [
      { name: "main.tsx", path: "/mock/project/src/main.tsx", isDirectory: false },
      { name: "App.tsx", path: "/mock/project/src/App.tsx", isDirectory: false, modified: true },
      { name: "index.css", path: "/mock/project/src/index.css", isDirectory: false },
      {
        name: "components",
        path: "/mock/project/src/components",
        isDirectory: true,
        children: [
          { name: "Header.tsx", path: "/mock/project/src/components/Header.tsx", isDirectory: false },
          { name: "PostCard.tsx", path: "/mock/project/src/components/PostCard.tsx", isDirectory: false, modified: true },
          { name: "Layout.tsx", path: "/mock/project/src/components/Layout.tsx", isDirectory: false },
          { name: "Footer.tsx", path: "/mock/project/src/components/Footer.tsx", isDirectory: false },
        ],
      },
      {
        name: "pages",
        path: "/mock/project/src/pages",
        isDirectory: true,
        children: [
          { name: "Home.tsx", path: "/mock/project/src/pages/Home.tsx", isDirectory: false },
          { name: "Post.tsx", path: "/mock/project/src/pages/Post.tsx", isDirectory: false },
          { name: "About.tsx", path: "/mock/project/src/pages/About.tsx", isDirectory: false },
        ],
      },
      {
        name: "types",
        path: "/mock/project/src/types",
        isDirectory: true,
        children: [
          { name: "post.ts", path: "/mock/project/src/types/post.ts", isDirectory: false },
        ],
      },
    ],
  },
  {
    name: "public",
    path: "/mock/project/public",
    isDirectory: true,
    children: [
      { name: "favicon.svg", path: "/mock/project/public/favicon.svg", isDirectory: false },
    ],
  },
];

const MOCK_FILE_CONTENT: Record<string, string> = {
  "/mock/project/CLAUDE.md":
    "# 个人博客\n\n基于 React + Vite + TypeScript 的个人技术博客。\n\n## 技术栈\n- React 18 + Vite 5\n- TypeScript strict\n- Tailwind CSS 3\n- Markdown 渲染 (react-markdown)\n\n## 项目结构\n- `src/components/` — 可复用 UI 组件\n- `src/pages/` — 页面级组件\n- `src/types/` — TypeScript 类型定义\n\n## 开发\n```bash\nnpm run dev     # 启动开发服务器\nnpm run build   # 生产构建\n```\n",
  "/mock/project/task.json":
    '{\n  "project": "个人博客",\n  "tasks": [\n    {\n      "id": 1,\n      "title": "项目初始化 — Vite + React + TS",\n      "status": "done"\n    },\n    {\n      "id": 2,\n      "title": "首页文章列表组件",\n      "status": "done"\n    },\n    {\n      "id": 3,\n      "title": "文章详情页 + Markdown 渲染",\n      "status": "running"\n    },\n    {\n      "id": 4,\n      "title": "标签分类与搜索",\n      "status": "pending"\n    },\n    {\n      "id": 5,\n      "title": "部署到 GitHub Pages",\n      "status": "pending"\n    }\n  ]\n}\n',
  "/mock/project/package.json":
    '{\n  "name": "personal-blog",\n  "private": true,\n  "version": "0.1.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build",\n    "preview": "vite preview"\n  },\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18.3.1",\n    "react-markdown": "^9.0.1",\n    "react-router-dom": "^6.26.0"\n  },\n  "devDependencies": {\n    "@types/react": "^18.3.3",\n    "@types/react-dom": "^18.3.0",\n    "typescript": "^5.5.4",\n    "vite": "^5.4.0",\n    "@vitejs/plugin-react": "^4.3.1",\n    "tailwindcss": "^3.4.10"\n  }\n}\n',
  "/mock/project/tsconfig.json":
    '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "useDefineForClassFields": true,\n    "lib": ["ES2020", "DOM", "DOM.Iterable"],\n    "module": "ESNext",\n    "skipLibCheck": true,\n    "moduleResolution": "bundler",\n    "allowImportingTsExtensions": true,\n    "resolveJsonModule": true,\n    "isolatedModules": true,\n    "noEmit": true,\n    "jsx": "react-jsx",\n    "strict": true,\n    "noUnusedLocals": true,\n    "noUnusedParameters": true,\n    "noFallthroughCasesInSwitch": true\n  },\n  "include": ["src"]\n}\n',
  "/mock/project/index.html":
    '<!DOCTYPE html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>个人博客 — 技术随想</title>\n  </head>\n  <body class="bg-white text-gray-900">\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
  "/mock/project/src/main.tsx":
    'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport { BrowserRouter } from "react-router-dom";\nimport App from "./App";\nimport "./index.css";\n\nReactDOM.createRoot(document.getElementById("root")!).render(\n  <React.StrictMode>\n    <BrowserRouter>\n      <App />\n    </BrowserRouter>\n  </React.StrictMode>\n);\n',
  "/mock/project/src/App.tsx":
    'import { Routes, Route } from "react-router-dom";\nimport Layout from "./components/Layout";\nimport Home from "./pages/Home";\nimport Post from "./pages/Post";\nimport About from "./pages/About";\n\nexport default function App(): JSX.Element {\n  return (\n    <Layout>\n      <Routes>\n        <Route path="/" element={<Home />} />\n        <Route path="/post/:slug" element={<Post />} />\n        <Route path="/about" element={<About />} />\n      </Routes>\n    </Layout>\n  );\n}\n',
  "/mock/project/src/index.css":
    '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@layer base {\n  body {\n    @apply antialiased;\n    font-family: "Inter", system-ui, sans-serif;\n  }\n\n  ::selection {\n    @apply bg-emerald-200 text-emerald-900;\n  }\n}\n\n@layer components {\n  .prose {\n    @apply max-w-none leading-relaxed;\n  }\n}\n',
  "/mock/project/src/components/Header.tsx":
    'import { Link } from "react-router-dom";\n\nexport default function Header(): JSX.Element {\n  return (\n    <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">\n      <nav className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">\n        <Link to="/" className="text-lg font-bold text-emerald-700">\n          技术随想\n        </Link>\n        <div className="flex gap-6 text-sm text-gray-600">\n          <Link to="/" className="hover:text-emerald-600 transition-colors">\n            首页\n          </Link>\n          <Link to="/about" className="hover:text-emerald-600 transition-colors">\n            关于\n          </Link>\n        </div>\n      </nav>\n    </header>\n  );\n}\n',
  "/mock/project/src/components/PostCard.tsx":
    'import { Link } from "react-router-dom";\nimport type { PostMeta } from "../types/post";\n\ninterface Props {\n  post: PostMeta;\n}\n\nexport default function PostCard({ post }: Props): JSX.Element {\n  return (\n    <article className="py-6 border-b border-gray-100 last:border-0">\n      <time className="text-xs text-gray-400">{post.date}</time>\n      <Link to={`/post/${post.slug}`}>\n        <h2 className="text-xl font-semibold mt-1 mb-2 hover:text-emerald-600 transition-colors">\n          {post.title}\n        </h2>\n      </Link>\n      <p className="text-sm text-gray-500 leading-relaxed">{post.excerpt}</p>\n      <div className="flex gap-2 mt-3">\n        {post.tags.map((tag) => (\n          <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">\n            {tag}\n          </span>\n        ))}\n      </div>\n    </article>\n  );\n}\n',
  "/mock/project/src/components/Layout.tsx":
    'import Header from "./Header";\nimport Footer from "./Footer";\n\ninterface Props {\n  children: React.ReactNode;\n}\n\nexport default function Layout({ children }: Props): JSX.Element {\n  return (\n    <div className="min-h-screen flex flex-col">\n      <Header />\n      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">\n        {children}\n      </main>\n      <Footer />\n    </div>\n  );\n}\n',
  "/mock/project/src/components/Footer.tsx":
    'export default function Footer(): JSX.Element {\n  const year = new Date().getFullYear();\n  return (\n    <footer className="border-t py-8 text-center text-sm text-gray-400">\n      <p>&copy; {year} 技术随想 — 基于 React + Vite 构建</p>\n    </footer>\n  );\n}\n',
  "/mock/project/src/pages/Home.tsx":
    'import { useState, useEffect } from "react";\nimport PostCard from "../components/PostCard";\nimport type { PostMeta } from "../types/post";\n\nconst MOCK_POSTS: PostMeta[] = [\n  {\n    slug: "hello-world",\n    title: "Hello World — 第一篇博客",\n    date: "2026-05-01",\n    excerpt: "这是我的第一篇技术博客，记录学习 React 和 TypeScript 的心得体会。",\n    tags: ["React", "TypeScript"],\n  },\n  {\n    slug: "tailwind-tips",\n    title: "Tailwind CSS 实用技巧",\n    date: "2026-05-10",\n    excerpt: "分享几个在日常开发中常用的 Tailwind CSS 技巧和最佳实践。",\n    tags: ["CSS", "Tailwind"],\n  },\n  {\n    slug: "vite-setup",\n    title: "Vite 项目搭建指南",\n    date: "2026-05-20",\n    excerpt: "从零搭建一个 Vite + React + TypeScript 项目的完整步骤。",\n    tags: ["Vite", "工具"],\n  },\n];\n\nexport default function Home(): JSX.Element {\n  const [posts] = useState<PostMeta[]>(MOCK_POSTS);\n\n  return (\n    <div>\n      <h1 className="text-2xl font-bold mb-8">最新文章</h1>\n      {posts.map((post) => (\n        <PostCard key={post.slug} post={post} />\n      ))}\n    </div>\n  );\n}\n',
  "/mock/project/src/pages/Post.tsx":
    'import { useParams } from "react-router-dom";\nimport ReactMarkdown from "react-markdown";\n\nconst MOCK_CONTENT = `\n# Hello World — 第一篇博客\n\n欢迎来到我的技术博客！这里将记录我在前端开发中的学习与思考。\n\n## 为什么选择 React + TypeScript\n\nTypeScript 提供了静态类型检查，让代码更加健壮。\n结合 React 的组件化思想，可以构建可维护的大型应用。\n\n## 后续计划\n\n- 完善博客的 Markdown 渲染\n- 添加标签分类功能\n- 实现 RSS 订阅\n`;\n\nexport default function Post(): JSX.Element {\n  const { slug } = useParams<{ slug: string }>();\n\n  return (\n    <article className="prose">\n      <ReactMarkdown>{MOCK_CONTENT}</ReactMarkdown>\n    </article>\n  );\n}\n',
  "/mock/project/src/pages/About.tsx":
    'export default function About(): JSX.Element {\n  return (\n    <div>\n      <h1 className="text-2xl font-bold mb-6">关于我</h1>\n      <div className="prose text-gray-600 space-y-4">\n        <p>\n          一名前端开发者，热爱 React 生态和开源技术。\n        </p>\n        <p>\n          这个博客用于记录学习过程中的思考和总结，\n          也希望能帮助到其他开发者。\n        </p>\n        <p>\n          技术栈: React, TypeScript, Vite, Tailwind CSS, Node.js\n        </p>\n      </div>\n    </div>\n  );\n}\n',
  "/mock/project/src/types/post.ts":
    'export interface PostMeta {\n  slug: string;\n  title: string;\n  date: string;\n  excerpt: string;\n  tags: string[];\n}\n\nexport interface Post extends PostMeta {\n  content: string;\n}\n',
  "/mock/project/public/favicon.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n  <rect width="32" height="32" rx="6" fill="#059669"/>\n  <text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-family="sans-serif">\n    B\n  </text>\n</svg>\n',
};

const MOCK_CONVERSATIONS = [
  { id: "conv-1", title: "项目初始化讨论", createdAt: Date.now() - 86400000, updatedAt: Date.now() - 3600000 },
  { id: "conv-2", title: "数据库设计讨论", createdAt: Date.now() - 172800000, updatedAt: Date.now() - 7200000 },
  { id: "conv-3", title: "部署方案分析", createdAt: Date.now() - 259200000, updatedAt: Date.now() - 86400000 },
];

let MOCK_SESSIONS: Session[] = [
  {
    id: "sess-1", projectId: "mock-1", title: "项目初始化讨论",
    createdAt: "2026-05-15T08:30:00.000Z", lastActiveAt: "2026-05-15T09:15:00.000Z",
    claudeSessionId: "claude-sess-abc", status: "completed",
  },
  {
    id: "sess-2", projectId: "mock-1", title: "部署方案讨论",
    createdAt: "2026-05-22T14:00:00.000Z", lastActiveAt: "2026-05-22T15:30:00.000Z",
    claudeSessionId: "claude-sess-def", status: "active",
  },
];

const MOCK_CHAT_HISTORY: Record<string, StreamEvent[]> = {
  "sess-1": [
    { runId: "sess-1", type: "user_message", data: { text: "我想搭建一个个人技术博客，用 React + Vite + TypeScript，推荐什么项目结构？" }, timestamp: 1715761800000, source: "chat" },
    { runId: "sess-1", type: "assistant", data: { text: "推荐以下项目结构：`src/components/` 放可复用组件（Header, Layout, PostCard），`src/pages/` 放页面级组件（Home, Post, About），`src/types/` 放 TypeScript 类型定义。使用 Vite 的快速 HMR 可以极大提升开发体验。" }, timestamp: 1715761860000, source: "chat" },
    { runId: "sess-1", type: "user_message", data: { text: "好的，Tailwind CSS 适合博客项目吗？" }, timestamp: 1715761920000, source: "chat" },
    { runId: "sess-1", type: "assistant", data: { text: "非常适合！Tailwind 的 utility-first 方式让博客排版非常灵活，特别是处理 Markdown 渲染后的 `prose` 样式。配合 `@tailwindcss/typography` 插件可以快速美化文章内容。" }, timestamp: 1715761980000, source: "chat" },
  ],
  "sess-2": [
    { runId: "sess-2", type: "user_message", data: { text: "博客开发完成了，怎么部署到 GitHub Pages？" }, timestamp: 1716364800000, source: "chat" },
    { runId: "sess-2", type: "assistant", data: { text: "步骤：1) 在 `vite.config.ts` 中设置 `base: '/your-repo-name/'`；2) 安装 `gh-pages`；3) 添加 `deploy` 脚本：`gh-pages -d dist`；4) 在 GitHub 仓库 Settings > Pages 中选择 `gh-pages` 分支。" }, timestamp: 1716364860000, source: "chat" },
    { runId: "sess-2", type: "user_message", data: { text: "有没有免费的方案？不需要自定义域名。" }, timestamp: 1716364920000, source: "chat" },
    { runId: "sess-2", type: "assistant", data: { text: "GitHub Pages 完全免费！也可以考虑 Vercel 或 Netlify，它们会自动从 Git 仓库部署，而且支持自定义构建命令。Vercel 对 Vite 项目的支持特别好，几乎是零配置。" }, timestamp: 1716364980000, source: "chat" },
  ],
};

const MOCK_CHAT_RESPONSES: Record<string, string> = {
  "博客": "关于博客项目，推荐使用 React + Vite + TypeScript 技术栈。核心功能包括：文章列表（PostCard 组件）、Markdown 渲染（react-markdown）、标签分类系统。Vite 的 HMR 在开发时非常快，构建产物也很小。建议使用 Tailwind CSS 处理样式，typography 插件可以美化 Markdown 输出。",
  "分析": "分析当前项目：这是一个基于 React 18 + Vite 5 + TypeScript 的技术博客。代码结构清晰，组件拆分合理。建议优化的地方：1) 添加单元测试（Vitest）；2) 为 PostCard 添加 loading skeleton；3) 考虑使用 React.lazy 对页面组件做代码分割；4) 添加 SEO meta 标签（react-helmet-async）。",
  "项目": "当前项目「个人博客」状态：开发中。已完成：项目初始化、首页文章列表、文章详情页 Markdown 渲染。待完成：标签分类与搜索、部署配置。建议下一步优先完成标签分类功能，因为它是搜索功能的前置依赖。",
};

const MOCK_STREAM_EVENTS: StreamEvent[] = [
  { runId: "mock-run", type: "system", data: { message: "启动 Claude Code..." }, timestamp: Date.now(), source: "worker" },
  { runId: "mock-run", type: "assistant", data: { text: "正在读取 task.json 和 CLAUDE.md..." }, timestamp: Date.now() + 100, source: "worker" },
  { runId: "mock-run", type: "tool_use", data: { tool: "Read", args: { file_path: "task.json" } }, timestamp: Date.now() + 200, source: "worker" },
  { runId: "mock-run", type: "tool_result", data: { result: "task.json 读取成功 — 5 个任务，第 3 个进行中" }, timestamp: Date.now() + 500, source: "worker" },
  { runId: "mock-run", type: "assistant", data: { text: "当前任务 #3：文章详情页 + Markdown 渲染。我来实现 Post.tsx 页面组件，集成 react-markdown..." }, timestamp: Date.now() + 600, source: "worker" },
  { runId: "mock-run", type: "tool_use", data: { tool: "Write", args: { file_path: "src/pages/Post.tsx" } }, timestamp: Date.now() + 800, source: "worker" },
  { runId: "mock-run", type: "tool_result", data: { result: "文件写入成功" }, timestamp: Date.now() + 1100, source: "worker" },
  { runId: "mock-run", type: "assistant", data: { text: "Post.tsx 已完成，包含 Markdown 渲染和 useParams 路由参数处理。" }, timestamp: Date.now() + 1200, source: "worker" },
];

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

let _streamCallback: ((event: StreamEvent) => void) | null = null;
let _exitCallback: ((data: { runId: string; code: number }) => void) | null = null;

export const electronAPIMock = {
  dialog: {
    openDirectory: () => delay("/Users/demo/projects"),
  },
  project: {
    list: () => delay(MOCK_PROJECTS),
    create: (opts: { name: string; path: string }) =>
      delay({
        id: `mock-${Date.now()}`, name: opts.name,
        path: `${opts.path}/${opts.name}`,
        createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(),
        status: "setup" as const, description: "",
      }, 400),
    delete: (_id: string) => delay(undefined),
    get: (id: string) => delay(MOCK_PROJECTS.find((p) => p.id === id)),
  },
  file: {
    readTree: (_dirPath: string) => delay(MOCK_FILE_TREE),
    readContent: (filePath: string) => delay(MOCK_FILE_CONTENT[filePath] ?? "// 文件内容\n"),
    writeContent: (_filePath: string, _content: string) => delay(undefined),
  },
  agent: {
    runWorker: (_projectPath: string, _prompt: string) => {
      const runId = `run-${Date.now()}`;
      // Simulate streaming events after a short delay
      setTimeout(() => {
        if (_streamCallback) {
          MOCK_STREAM_EVENTS.forEach((ev, i) => setTimeout(() => _streamCallback!(ev), i * 300));
        }
      }, 200);
      // Simulate exit after worker events
      setTimeout(() => {
        if (_exitCallback) {
          _exitCallback({ runId, code: 0 });
        }
      }, 2000 + MOCK_STREAM_EVENTS.length * 300);
      return delay({ runId });
    sendMessage: (_projectPath: string, message: string, _sessionId?: string | null) => {
      const chatId = 'mock-chat';
      setTimeout(() => {
        if (_streamCallback) {
          _streamCallback({ runId: chatId, type: 'assistant', data: { text: `收到: "${message}"。这是模拟回复。` }, timestamp: Date.now(), source: 'chat' as const });
        }
      }, 600);
      setTimeout(() => { if (_exitCallback) _exitCallback({ runId: chatId, code: 0 }); }, 800);
      return delay({ chatId, sessionId: 'mock-sess' });
    },
    abort: (_runId: string) => {},

    },
    onStderr: (_callback: (data: { runId: string; data: string; timestamp: number }) => void) => {
      return () => {};
    },
    onExit: (callback: (data: { runId: string; code: number }) => void) => {
      _exitCallback = callback;
      return () => { _exitCallback = null; };
    },
  },
  evaluator: {
    isEnabled: () => delay(true),
    setEnabled: (_enabled: boolean) => delay(undefined),
    status: () => delay({ running: false }),
    runEvaluator: (_projectPath: string) => {
      const evalId = `eval-${Date.now()}`;
      setTimeout(() => {
        if (_streamCallback) {
          _streamCallback({
            runId: evalId,
            type: "system",
            data: { message: "评估 Agent 已启动 — 按 EVALUATOR.md 流程评估..." },
            timestamp: Date.now(),
            source: "evaluator",
          });
        }
      }, 200);
      setTimeout(() => {
        if (_exitCallback) {
          _exitCallback({ runId: evalId, code: 0 });
        }
      }, 1500);
      return delay({ evalId });
    },
    abort: (_evalId: string) => delay(undefined),
  },
  claude: {
    detect: () => delay({ found: true, path: "/usr/local/bin/claude", version: "1.0.0" }),
  },
  conv: {
    list: () => delay(MOCK_CONVERSATIONS),
    create: (title?: string) => delay({ id: `conv-${Date.now()}`, title: title || "新对话", createdAt: Date.now(), updatedAt: Date.now() }),
    update: (id: string, patch: Record<string, unknown>) => delay({ id, title: (patch.title as string) || "新对话", createdAt: Date.now() - 3600000, updatedAt: Date.now() }),
    delete: (_id: string) => delay(undefined),
    messages: (_id: string) => delay([{ id: "msg-1", role: "user", content: "你好", createdAt: Date.now() - 60000 }, { id: "msg-2", role: "assistant", content: "你好！有什么可以帮助你的？", createdAt: Date.now() - 30000 }]),
    appendMessage: (_convId: string, _message: Record<string, unknown>) => delay(undefined),
  },
  session: {
    list: (_projectId: string) => delay([...MOCK_SESSIONS]),
    resume: (sessionId: string) => {
      const history = MOCK_CHAT_HISTORY[sessionId];
      if (history && _streamCallback) {
        history.forEach((ev, i) => {
          setTimeout(() => _streamCallback!(ev), i * 200 + 100);
        });
      }
    },
    create: (projectId: string, title: string) => {
      const newSession: Session = {
        id: `sess-${Date.now()}`,
        projectId,
        title,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        claudeSessionId: `claude-sess-${Date.now()}`,
        status: "active",
      };
      MOCK_SESSIONS = [newSession, ...MOCK_SESSIONS];
      return delay(newSession);
    },
    delete: (_projectId: string, sessionId: string) => {
      MOCK_SESSIONS = MOCK_SESSIONS.filter((s) => s.id !== sessionId);
      return delay(undefined);
    },
  },
  settings: {
    get: () => delay({ terminalFontSize: 14, evaluateMode: true, tddMode: false, screenshotVerification: false, apiBaseUrl: "", apiKey: "" }),
    set: (_key: string, _value: unknown) => delay(undefined),
  },
};
