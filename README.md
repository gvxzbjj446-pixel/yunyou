# 云游中国 · 3D 全景沉浸式城市旅游

基于真实卫星影像、真实地形与 OpenStreetMap 建筑的 3D 城市漫游网站，默认濮阳（五县一区精细建模，重点范县），郑州同为精细建模城市。打开即进入城市，先播放一段电影级运镜的宣传片，关键景点有提示符，可以查看介绍、攻略与附近店铺，也可以“进入景点”在街头第一人称漫游，或切换航拍、无人机自由探索。

## 功能

| 模块 | 说明 |
| --- | --- |
| 真实地球底座 | Esri World Imagery 卫星影像（郑州市区最高 z19 ≈ 0.25 m/像素）+ AWS Terrarium 地形，四叉树按屏幕空间误差流式加载，裙边遮缝 |
| 城市建筑 | OSM 建筑轮廓（Web Worker 生成网格），有 height/levels 用实值，否则按用途、面积、长宽比与瓦片密度估高；程序化立面（住宅塔楼/板楼/玻璃幕墙/商业裙楼/低层），夜间随机亮窗 |
| 精细地标（郑州） | 二七纪念塔（双五边形联体塔、绿琉璃飞檐、六面钟、五星）、千玺广场“大玉米”（旋转体 + 玉米粒幕墙 + 夜间流光）、会展中心（伞形屋顶 + 桅杆斜拉索）、河南艺术中心（五枚“陶埙”）、中原福塔（双曲面钢网格 + 塔楼 + 桅杆）、河南博物院（观星台意象）、商城遗址夯土城墙（OSM 实测走向）、城隍庙与少林寺殿宇（按 OSM 殿宇轮廓生成庑殿顶）、少林塔林、炎黄二帝巨塑 |
| 精细地标（濮阳 · 五县一区，重点范县） | 西水坡“中华第一龙”蚌塑龙虎（十倍放大复原展示）、张挥公园张氏宗祠（三进院落 + 石牌坊）、濮阳县城隍庙（11 座殿宇按实测轮廓）、戚城遗址（夯土城垣 + 园内仿古建筑）、水秀国际大剧院（示意外立面）、范县万亩荷花生态园（荷塘 + 栈道 + 观荷亭）、台前将军渡黄河浮桥；范县、濮阳县、台前、清丰、南乐与华龙区县城补充了 8.7 万栋影像识别建筑轮廓 |
| 光影 | 按真实太阳位置计算日出日落；程序化天空/云/星空；跟随视点的阴影贴图；环境反射；雾随高度变化 |
| 夜景 | 窗户灯光、“大玉米”流光、福塔 LED、OSM 道路生成的路灯光网 |
| 电影宣传片 | 分镜脚本（样条路径 / 环绕），黑场转场、遮幅、字幕、胶片调色；前瞻避障（机位下方有高楼时平滑抬升）；程序化五声音阶配乐 |
| 提示符与面板 | 景点 3D 提示符 → 介绍（精编介绍 + 维基百科摘要）/ 攻略（Wikivoyage + 实时天气）/ 附近店铺（OSM Overpass，配置高德 Key 后走高德） |
| 自由探索 | 🛰 航拍（环绕/平移/滚轮缩放至光标/双击飞近）· 🚶 漫游（贴地行走 + 建筑碰撞 + 行道树）· 🚁 无人机 |
| 选择城市 | 9 座预置城市（郑州、濮阳为精细建模）；支持搜索任意城市（Nominatim），自动发现景点并生成运镜 |
| 4K | “4K 超清”画质以 3840 像素宽渲染、加载 z19 影像、4096 阴影贴图；📷 导出 3840×2160 PNG |

## 运行

```bash
npm install          # 只依赖 three
npm start            # http://127.0.0.1:8720/
```

- 服务端零依赖（Node ≥ 22.21 / 24）。Node 内置 fetch 默认不走系统代理：若检测到 `HTTPS_PROXY` 或 Windows 系统代理，会带 `NODE_USE_ENV_PROXY=1` 自动重启自身。
- 可选 `.env`：`AMAP_KEY=`（高德 Web 服务 Key，周边店铺更全）、`CACHE_DIR=`、`PORT=`、`BASE_PATH=`。
- 所有第三方数据经服务端代理并缓存到 `cache/`（影像/地形永久、建筑 7 天浏览器缓存、攻略 7 天、天气 20 分钟）。

## 目录

```
server/server.mjs      静态资源 + /tiles/* /api/* 代理与缓存，--base 子路径
server/osm.mjs         Overpass（多镜像健康度选择）、建筑清洗与估高、店铺、景点发现
server/providers.mjs   Wikivoyage 攻略解析、维基摘要、Open-Meteo、Nominatim、高德
public/src/engine/     terrain / sky / buildings(+worker) / features / landmarks / modelkit / director / controls / post / world
public/src/ui/         hotspots / panels / audio
public/src/data/       cities.js（城市、景点、运镜脚本）、zhengzhou-geo.js（OSM 提取的地标轮廓）
deploy/start.sh        SCNet 监护启动脚本
```

## 自检（开发）

浏览器面板隐藏时 rAF 会暂停：在控制台用 `await world.settle(ms)` 手动推进帧直到加载完成，`await world.snapshot('name')` 把当前帧存到 `cache/snaps/name.png`。

## 部署（SCNet）

挂在 ORBIT 的子路径转发下：`PROXY_ROUTES=/hot-news/=http://127.0.0.1:8502,/cloud-tour/=http://127.0.0.1:8725`，本服务以 `--base /cloud-tour/` 只监听回环地址，由 `deploy/start.sh` 监护，开机由 jupyter 钩子拉起。

## 数据来源与许可

濮阳县城区的补充建筑轮廓来自 Overture Maps Foundation 建筑数据中非 OSM 的影像识别部分（ODbL），存放于 `data/buildings-supplement/`，由 `tools/overture-osm-cache.py --supplement` 生成，服务端与 Overpass 结果合并（与 OSM 重叠者自动让位）。

影像 © Esri, Maxar, Earthstar Geographics；地形 AWS Terrain Tiles（Mapzen/Terrarium）；建筑、道路、店铺 © OpenStreetMap 贡献者（ODbL）；攻略 Wikivoyage、百科 Wikipedia（CC BY-SA 4.0）；天气 Open-Meteo；地理编码 Nominatim。景点实用信息（开放时间/门票）仅供参考。
