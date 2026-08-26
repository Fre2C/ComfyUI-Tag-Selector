# ComfyUI-Tag-Selector

把 [Danbooru-Tag-Selector](../Danbooru-Tag-Selector/)（纯前端单文件网页工具）以 iframe 方案嵌入 ComfyUI 的插件，并让「ComfyUI 内的浮窗」与「双击打开的本地网页」共享同一份数据账本。

插件完全自包含：页面、数据集、账本全部在本目录内，运行时不依赖任何外部路径。

## 工作原理

插件在 ComfyUI 本地服务器上注册三个网址：

| 网址 | 内容 |
|---|---|
| `/tag_selector/page` | 返回本目录的 `Danbooru-Tag-Selector.html`（上游页面快照 + 桥接脚本） |
| `/tag_selector/dataset` | 按需返回内置数据集 `tags_with_groups.csv`（首次读取后常驻内存） |
| `/tag_selector/data` | 共享账本 `data/dts_data.json` 的读 / 写接口 |

## 双入口，一本账

```
ComfyUI 浮窗 ── HTTP 路由 ──┐
                            ├──→ data/dts_data.json（唯一真相源）
双击离线页面 ── File System Access ──┘
```

- **浮窗入口**：节点上点按钮或双击节点，弹出可拖拽 / 可缩放 / 失焦不关闭的真浮窗
- **本地入口**：双击本目录的 `Danbooru-Tag-Selector.html`，通过 File System Access API 直接读写账本文件
- 任一处改动都会在半秒内写入账本，另一边打开时自动灌入；并发写入采用最后写入获胜
- 首次连接账本时若本地有旧收藏而账本为空，自动整柜搬入

因为账本是硬盘上的普通 JSON 文件：备份 = 复制文件，迁移 = 带着它走，换浏览器 / 清缓存不再丢数据。

## 文件结构

```
ComfyUI-Tag-Selector/
├── __init__.py                  # 节点定义 + 路由挂载（薄壳）
├── core.py                      # 共享逻辑：读页面 / 数据集 / 账本原子读写
├── sync_upstream.py             # 上游同步命令（见下）
├── Danbooru-Tag-Selector.html   # 页面资产：上游快照 + 桥接脚本（双击入口；生成物，不入库）
├── data/
│   └── dts_data.json            # 收藏 · 历史 · 预设的唯一账本（个人数据，不入库）
└── web/
    ├── bridge_inject.js         # 桥接脚本真相源（sync 时注入进页面资产）
    └── tag_selector_bridge.js   # 宿主侧扩展：按钮 · 浮窗 · postMessage 写回
```

## 资产获取与上游同步

页面文件缺失时，插件会在 ComfyUI 启动时自动从上游 GitHub 仓库下载并注入桥接（已存在的文件永不覆盖）。也可以手动控制：

```
python sync_upstream.py            # 补齐缺失资产
python sync_upstream.py --force    # 强制重新拉取全部
```

数据集 CSV 不在上游仓库中，需按上游「数据集」章节自行生成后放入本目录（支持 `tags_with_groups.csv` 或 `tags_enhanced.csv` 文件名）；缺失时浮窗与启动日志都会给出指引。

## 消息协议（`dts_` 前缀）

```
宿主 → 页面:  dts_set_text {text} · dts_load_dataset {url} · dts_get_text
页面 → 宿主:  dts_ready · dts_text_changed {text} · dts_text {text} · dts_ledger_status {connected, mode, error}
```

节点文本与候选区文本框双向实时同步；节点文本在数据集装载完成后才应用（避免被初始化清空）。

## 安装

整个文件夹放进 ComfyUI 的 `custom_nodes` 目录，重启 ComfyUI。

### 从源码 clone 后的首次准备

仓库出于体积与隐私考虑不含两样东西，需要自行生成 / 放置：

| 文件 | 性质 | 如何获得 |
|---|---|---|
| `Danbooru-Tag-Selector.html` | 生成物 | 首次启动 ComfyUI 时自动从上游仓库下载；也可手动运行 `python sync_upstream.py --force` 重新拉取 |
| `tags_with_groups.csv` | 数据集 | 获取方式见上游 [Danbooru-Tag-Selector 的「数据集」章节](https://github.com/Fre2C/Danbooru-Tag-Selector#数据集)：由第三方标签数据经 `data_tool/` 脚本合并生成，放入本目录即可；文件名 `tags_enhanced.csv` 也被识别 |
| `data/` | 个人账本 | 首次写入时自动创建，无需手动建 |

未生成页面前，浮窗与双击入口会提示运行 sync 命令。

## 已知限制

- PapaParse 仍走 CDN：完全离线时上传 CSV 与内置数据集解析不可用（`web/papaparse.min.js` 为占位，待填入官方构建后切换为本地引用）
- `file://` 打开的离线页面，其文件访问权限不跨浏览器会话持久（Chromium 对本地页面的安全设计）：每次重新打开需点一次横幅按钮并在浏览器弹窗中允许。需要彻底免授权时，可通过本地 HTTP 服务访问（权限即持久）
