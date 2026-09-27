# 云游中国：云端开发交接

## 恢复来源与边界

2026-09-27 从 Windows 开发副本恢复本仓库，并与 SCNet 上 `/root/private_data/cloud-tour-3d` 的源码逐文件比对。

- 25 个共同文件逐字节一致，包含地标模型、城市数据、运镜和核心坐标逻辑。
- 本机的 7 个文件保留了服务器快照之后的修改：`deploy/push.py`、`package.json`、`public/css/app.css`、`public/index.html`、`public/src/engine/features.js`、`public/src/engine/world.js`、`public/src/main.js`。
- 本机还保留了服务器快照缺少的 `test/core.test.mjs`。
- 服务器唯一额外文件为 `deploy/.ps__*` 临时副本，内容与 `deploy/start.sh` 相同，未导入。
- 恢复时未修改原本机项目或服务器服务。服务器源码另有独立本地备份。
- 本次只恢复源码与交接材料，没有从零重建，也没有重新验证所有视觉效果。

## 启动与测试

使用 Node.js 24（恢复验证时为 v24.18.0）。

```bash
npm ci
npm test
npm start
```

默认地址 `http://127.0.0.1:8720/`，健康检查 `/api/health`。
若云端预览要求监听所有接口，可运行：

```bash
node server/server.mjs --host 0.0.0.0 --port 8720
```

恢复副本的现有 9 项回归测试全部通过，覆盖质心精度、坐标转换、建筑过滤与估高、轮廓拼接、攻略解析。这不等同于浏览器视觉验收。

## 已保留的实现

- 郑州地标与其他城市配置、宣传片运镜、航拍/漫游/无人机模式。
- 二七塔轮廓质心精度修复，以及地下站房过滤逻辑。
- 顶栏换行后侧面板位置自适应，窄屏工具栏文字收缩。
- 夜景道路按等级区分亮度。
- 4K 截图等待高清瓦片的逻辑。
- `deploy/push.py --pull-osm`：原开发环境用于取回服务器 OSM 缓存。

## 2026-09-27 云端复查结果

复查环境：云端容器只放行 AWS S3，Esri 影像、Overpass、Wikipedia、Open-Meteo、Nominatim 均被网络策略拦截。
建筑与道路改用 `tools/overture-osm-cache.py` 从 Overture Maps（S3）提取的 **OSM 来源**要素写入本地原始缓存，
经现有 `processBuildings` / `processFeatures` 规则处理；影像缺失时地面为降级纹理。验证用 headless Chromium（SwiftShader）
暂停渲染循环、以 `world.settle()` / `world.snapshot()` 逐帧推进截图。

| 项目 | 结论 | 处理 |
| --- | --- | --- |
| 二七塔 OSM 重叠 | 周边仅塔本体 w730973930（已被圆形排除区剔除）和地下站房 w1036270206（level −1，已过滤），最近其他建筑距塔约 60 m，无重叠 | 无需改动 |
| 二七塔机位穿帮 | “环绕欣赏”机位（150 m / 70 m）落进南侧高层立面内；“飞往景点”机位被前景高楼挡住塔身；航拍环绕无任何避楼逻辑 | 航拍相机近距离按下方楼顶平滑抬升（`controls.js`）；景点机位按视线/机位遮挡搜索朝向与俯角，飞抵后再校正（`main.js clearPose`）。36 个方位自动环绕实测机位最低仍高于楼顶 13 m |
| 漫游碰撞 | 由入口向塔直走停在台基内凹边外（距中心 7.9 m），不进入塔体；撞高层沿墙滑动，不穿墙 | 无需改动 |
| 影像不可用 | 影像请求失败时地形瓦片整体不显示（根瓦片失败即全城无地面） | 地形改为高程 + 降级纹理，影像连续失败后暂停 60 s，恢复后自动换上真实影像；服务端瓦片上游加熔断，避免预取排队拖住实时请求 |
| 夜景 | 全城窗户几乎全亮且同一贴图图案重复，自发光 ×4 叠加低阈值泛光，整幅画面发白起雾；二七塔偏暗 | 亮灯纹理画满窗户，由着色器按“楼栋 × 窗格”哈希决定亮灯，约两成楼基本熄灯；自发光 ×2、泛光强度/阈值下调；路灯光点缩小；二七塔塔身泛光增强。白天画面不受影响 |
| 城市切换 | 8 座预置城市经选择器依次切换：hash、标题、按钮、选中态、提示符与景点列表数量均正确；图层 3 个、场景子节点 8 个保持不变（无泄漏）；回到郑州 11 个地标模型齐全；无页面错误 | 无需改动 |
| 顶栏/面板布局 | 390/768/1024/1440 宽度下顶栏与面板、景点列表不重叠，无横向滚动；景点面板作为抽屉覆盖小地图/底部模式栏属设计行为 | 无需改动 |

### 第二轮（Loop）

| 项目 | 结论 | 处理 |
| --- | --- | --- |
| 宣传片穿帮 | 郑州 10 个镜头、111 s 逐帧采样，机位距楼顶/地面最低 74 m | 无需改动 |
| 宣传片遮挡 | 仅商城遗址低空镜头被老城高楼挡住城墙（6/18 采样） | 该镜头抬高到 520/470/430 m；导演新增视线避障（只看普通建筑，忽略主体模型与最后 1/4 视线，上限 220 m），郑州现有镜头均无需运行时抬升，作为其他城市自动运镜的兜底 |
| 第三方接口故障 | 攻略接口上游故障时返回空攻略并被缓存 7 天；前端把失败结果永久缓存在内存中 | 上游故障改为 502 不缓存；前端失败后可重试，攻略页增加重试按钮，提示文案不再暴露技术错误；新增 `test/providers.test.mjs` |
| 用户流程 | 欢迎页 → 自由探索 → 提示符 → 景点面板 → 进入景点（落点误差 0 m、眼高 1.7 m）→ WASD 行走 → 无人机升降 → 重播宣传片 → 播完回到探索（FOV 复原）全部正常；4K 导出 3840×2160 | 无需改动 |
| 漫游入口视野 | 环岛两侧行道树围住二七塔塔基，进入景点时看不到塔的下半部 | 地标台基外扩 20 m 及“漫游入口→景点”宽 16 m 的视线走廊内不种行道树 |

测试脚本在无渲染的模拟时间下推进（`world.post.render` 置空后循环 `world.tick(1/30)`），SwiftShader 下每帧渲染约 3 s，按真实时间截止的 `settle()` 不适合验证飞行/动画结束状态。

### 濮阳（五县一区，重点范县）

- 城市配置 `public/src/data/puyang.js`：13 个景点覆盖华龙区、濮阳县、清丰、南乐、范县（县城、荷花生态园、黄河范县段、濮城镇）、台前；10 镜头 110 s 宣传片，范县三个镜头按“县城 → 荷塘 → 顺黄河东下”接台前将军渡落日。
- 景点坐标全部取自 OSM / Overture 实测要素，地理数据 `public/src/data/puyang-geo.js`；模型 `public/src/engine/landmarks-puyang.js`（7 个）。剧院外立面、蚌塑放大展示为示意，已在介绍中说明。
- 补充建筑：7 个县城区 8.7 万栋非 OSM 影像识别轮廓（3.8 MB，`data/buildings-supplement/14/`），服务端 `mergeSupplement` 合并，已处理缓存目录带 `s` 后缀；这类轮廓单独按县城分布估高（约 46% 1–3 层、43% 4–7 层、11% 高层），规则版本 7。
- 验证：7 个模型全部加载、无页面错误；宣传片逐帧 0 遮挡、0 运行时抬升，最低净空 72 m；荷塘水位取园内地形最高处，避免被滩区地面遮住。线上需复查：黄河河面（来自影像）、浮桥与河道的对位。

另：`package-lock.json` 的 `resolved` 由 npmmirror 改回 registry.npmjs.org（npm 会按各环境配置的 registry 替换，服务器上照常走镜像）。

## 下一步工作

1. 有 Esri 影像的环境（服务器/本机）复查真实卫星底图下的夜景与二七塔机位，确认观感与本次一致。
2. 服务器部署本次修改后做公网验收（需服务器访问权限，云端无法访问 ksai.scnet.cn）。
3. 其他城市在真实 OSM 数据下的景点机位（`clearPose` 同样生效）与宣传片抽查。
4. 修改后运行回归测试，并记录浏览器验证结果；无法访问外部数据时说明限制。

## 云端受限网络下的视觉验证

```bash
pip install pyarrow shapely
python3 tools/overture-osm-cache.py --bbox 113.55,34.70,113.80,34.82   # 郑州市区，写入 cache/osm/raw-b14、raw-f14
PROXY_BYPASS="" node server/server.mjs --port 8720                      # 云端代理为本地地址时须清空直连名单
```

浏览器控制台（或 Playwright `page.evaluate`）：`world.paused = true` 后调用 `await world.settle(60000)`、`await world.snapshot('name')`，
截图保存到 `cache/snaps/`。该脚本会覆盖 `cache/osm/raw-*`，不要对生产缓存运行。

## 缓存与云端网络

`cache/`、`node_modules/`、`.run/`、本地 Claude 配置和秘密值均未导入。模型与地理轮廓的源码位于 `public/src/engine/` 和 `public/src/data/`，已保留。

运行服务后会按需获取缓存，也可使用现有预热工具：

```bash
node tools/prewarm.mjs --base http://127.0.0.1:8720/ --city zhengzhou --conc 2 --features
```

该命令会请求外部数据；无需为了查看代码而立即做完整预热。网络失败不应通过删除地标、替换为空白地图或重建项目来掩盖。

功能依赖的外部服务包括：Esri `server.arcgisonline.com` / `services.arcgisonline.com`，地形 `s3.amazonaws.com`，OSM Overpass 镜像（见 `server/osm.mjs`），Wikipedia / Wikivoyage，`api.open-meteo.com`，`nominatim.openstreetmap.org` / `photon.komoot.io`。云端网络策略需要允许实际使用的服务。

可选环境变量：`AMAP_KEY`、`CACHE_DIR`、`PORT`、`HOST`、`BASE_PATH`。没有高德 Key 时使用 OSM 路径；不要提交真实 Key 或 SSH 密码。

## 部署边界

现有服务器部署使用端口 8725 和 `/cloud-tour/` 子路径。`deploy/start.sh` 和 `deploy/push.py` 保留了原环境约定，不代表云端可以访问原服务器。

云端开发先提交到本仓库；原服务器部署、公网验收需要有服务器访问权限的环境执行。不要从云端盲目运行部署脚本。
