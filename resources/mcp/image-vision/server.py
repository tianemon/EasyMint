import base64
import json
import mimetypes
import os
from pathlib import Path

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

VISION_BASE_URL = os.environ.get(
    "VISION_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
)
VISION_MODEL = os.environ.get("VISION_MODEL", "qwen3.6-flash")
VISION_API_KEY = os.environ.get("VISION_API_KEY")

server = Server("image-vision")


@server.list_tools()
async def list_tools():
    return [
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
    ]


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
        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            raise ValueError(f"Vision API returned empty choices: {resp.text[:200]}")
        return choices[0]["message"]["content"]


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
    if not VISION_API_KEY:
        return [TextContent(type="text", text="VISION_API_KEY 未配置。请在 EasyMint 设置 → 通用 → API Key 中填写。")]

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
