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

## 下一步工作

来自迁移前对话的待办，需要云端重新确认实际状态：

1. 二七塔内部穿帮、建筑重叠和漫游碰撞复查。
2. 夜景效果复查，尤其道路光网和地标灯光；先检查已恢复的修改，避免重复实现。
3. 城市切换、景点列表、攻略面板、顶栏叠加布局验证。
4. 保留现有地标与运镜，按具体现象做增量修复。
5. 修改后运行回归测试，并记录浏览器验证结果；无法访问外部数据时说明限制。

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
