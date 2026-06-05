import base64
import json
import mimetypes
import os
from pathlib import Path

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

CONFIG_DIR = Path.home() / ".config" / "image-vision"
CONFIG_FILE = CONFIG_DIR / "config.json"


def _load_api_key() -> str | None:
    # env var 优先，其次读配置文件
    key = os.environ.get("VISION_API_KEY")
    if key:
        return key
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text()).get("api_key")
        except Exception:
            return None
    return None


VISION_BASE_URL = os.environ.get(
    "VISION_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
)
VISION_MODEL = os.environ.get("VISION_MODEL", "qwen3.6-flash")
VISION_API_KEY = _load_api_key()

SETUP_MSG = """image-vision 尚未配置。请提供 API Key：

在终端中设置环境变量（推荐）：
  export VISION_API_KEY="sk-your-key-here"

或在此对话中说「帮我配置 image-vision」，调用 configure 工具保存。
申请地址：https://dashscope.console.aliyun.com/"""

server = Server("image-vision")


@server.list_tools()
async def list_tools():
    tools = [
        Tool(
            name="describe_image",
            description="描述图片内容。支持本地路径或 URL。",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "图片的本地绝对路径或 URL"},
                    "prompt": {"type": "string", "description": "可选的提示词，例如'详细描述UI界面的色彩搭配'。不填则用默认提示"},
                },
                "required": ["path"],
            },
        ),
        Tool(
            name="describe_images",
            description="批量描述多张图片，并行处理。",
            inputSchema={
                "type": "object",
                "properties": {
                    "paths": {"type": "array", "items": {"type": "string"}, "description": "图片的本地绝对路径或 URL 列表"},
                    "prompt": {"type": "string", "description": "可选的提示词，所有图片共用同一个 prompt。不填则用默认提示"},
                },
                "required": ["paths"],
            },
        ),
        Tool(
            name="configure",
            description="保存 API Key 到本地配置文件（~/.config/image-vision/config.json）。环境变量优先级更高。",
            inputSchema={
                "type": "object",
                "properties": {
                    "api_key": {"type": "string", "description": "视觉模型 API Key"},
                    "base_url": {"type": "string", "description": "API 地址，默认 DashScope"},
                    "model": {"type": "string", "description": "模型名，默认 qwen3.6-flash"},
                },
                "required": ["api_key"],
            },
        ),
    ]
    return tools


async def _call_vision(image_content: dict, prompt: str | None = None) -> str:
    body = {
        "model": VISION_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt or "Describe this image in detail."},
            image_content,
        ]}],
        "max_tokens": 1024,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{VISION_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {VISION_API_KEY}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def _build_image_content(source: str) -> dict:
    if source.startswith(("http://", "https://")):
        return {"type": "image_url", "image_url": {"url": source}}

    path = Path(source).expanduser()
    if not path.exists():
        raise ValueError(f"file not found: {source}")

    mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{data}"}}


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "configure":
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        cfg = {"api_key": arguments["api_key"]}
        if arguments.get("base_url"):
            cfg["base_url"] = arguments["base_url"]
        if arguments.get("model"):
            cfg["model"] = arguments["model"]
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
        return [TextContent(type="text", text="配置已保存。重启 Claude Code 后生效。")]

    if not VISION_API_KEY:
        return [TextContent(type="text", text=SETUP_MSG)]

    if name == "describe_image":
        img = _build_image_content(arguments["path"])
        caption = await _call_vision(img, arguments.get("prompt"))
        return [TextContent(type="text", text=caption)]

    if name == "describe_images":
        import asyncio
        prompt = arguments.get("prompt")
        imgs = [_build_image_content(p) for p in arguments["paths"]]
        captions = await asyncio.gather(*(_call_vision(img, prompt) for img in imgs))
        result = "\n\n".join(f"[Image {i+1}]\n{c}" for i, c in enumerate(captions))
        return [TextContent(type="text", text=result)]

    raise ValueError(f"unknown tool: {name}")


async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
