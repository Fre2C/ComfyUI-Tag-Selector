"""ComfyUI-Tag-Selector: iframe-bridge plugin.

Thin host: mounts the shared logic in core.py onto ComfyUI's server. The
vendored page (Danbooru-Tag-Selector.html, already carrying the bridge), the
dataset and the ledger are all self-contained inside this folder.
"""

import os
import sys

from aiohttp import web
from server import PromptServer

# make sibling modules importable regardless of how ComfyUI loads this folder
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import core  # noqa: E402

# auto-heal on startup: fetch the vendored page if it is missing. This never
# blocks ComfyUI (short timeout, existing files untouched) and any failure
# just prints instructions instead of raising.
try:
    import sync_upstream as _sync  # noqa: E402

    _sync.ensure_assets()
except Exception as _err:  # pragma: no cover
    print(f"[ComfyUI-Tag-Selector] asset check skipped: {_err}")


_PAGE_MISSING_HTML = """<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>ComfyUI Tag Selector - 缺少页面文件</title></head>
<body style="font-family:'Segoe UI',sans-serif;background:#1e1e22;color:#ddd;
             display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="max-width:600px;line-height:1.9;padding:32px 40px;
              border:1px solid #444;border-radius:12px;background:#26262b">
    <h2 style="margin-top:0;color:#ffd479">缺少页面文件 Danbooru-Tag-Selector.html</h2>
    <p>浮窗的界面本体还没就位。两种修复方式任选其一：</p>
    <p><b style="color:#8fd3a7">方法一（推荐）</b>：在插件目录打开终端，运行<br>
       <code style="background:#333;padding:2px 8px;border-radius:4px">python sync_upstream.py</code><br>
       脚本会从上游 GitHub 仓库自动下载并注入桥接。</p>
    <p><b style="color:#8fd3a7">方法二</b>：手动把 <code>Danbooru-Tag-Selector.html</code>
       复制到插件目录：<br>
       <code style="background:#333;padding:2px 8px;border-radius:4px;font-size:.85em">{plugin_dir}</code></p>
    <p style="opacity:.6">修复后刷新 ComfyUI 页面即可。</p>
  </div>
</body></html>
"""

_DATASET_MISSING_TEXT = (
    "数据集未找到。请将 tags_with_groups.csv 或 tags_enhanced.csv 放入插件目录：\n"
    f"{core._PLUGIN_DIR}\n"
    f"获取方式见上游项目 README「数据集」章节：{core.DATASET_DOC_URL}"
)


@PromptServer.instance.routes.get("/tag_selector/page")
async def tag_selector_page(request):
    """Serve the vendored page (upstream snapshot + bridge)."""
    html = core.read_page_html()
    if html is None:
        return web.Response(
            status=404,
            content_type="text/html",
            charset="utf-8",
            text=_PAGE_MISSING_HTML.replace("{plugin_dir}", str(core._PLUGIN_DIR)),
        )
    return web.Response(
        content_type="text/html",
        charset="utf-8",
        text=html,
        headers={"Cache-Control": "no-cache"},
    )


@PromptServer.instance.routes.get("/tag_selector/dataset")
async def tag_selector_dataset(request):
    """Serve the built-in dataset CSV (tags_with_groups or tags_enhanced)."""
    text = core.read_dataset_text()
    if text is None:
        return web.Response(status=404, text=_DATASET_MISSING_TEXT)
    return web.Response(
        content_type="text/csv",
        charset="utf-8",
        text=text,
        headers={"Cache-Control": "no-cache"},
    )


@PromptServer.instance.routes.get("/tag_selector/data")
async def ledger_get(request):
    """Read the shared ledger file."""
    return web.json_response(core.load_ledger())


@PromptServer.instance.routes.post("/tag_selector/data")
async def ledger_post(request):
    """Write the shared ledger file (last write wins)."""
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text="invalid json")
    if not isinstance(body, dict):
        return web.Response(status=400, text="expected a JSON object")
    core.save_ledger(body)
    return web.json_response({"ok": True})


class TagSelectorPrototype:
    """Pass-through node. The UI lives in the floating iframe; the bridge
    extension keeps the node's ``text`` widget in sync with the tool."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("tags",)
    FUNCTION = "run"
    CATEGORY = "Danbooru Tag Selector"

    def run(self, text):
        return (text,)


NODE_CLASS_MAPPINGS = {"TagSelectorPrototype": TagSelectorPrototype}
NODE_DISPLAY_NAME_MAPPINGS = {"TagSelectorPrototype": "Danbooru Tag Selector"}
WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
