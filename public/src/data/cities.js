// 城市与景点数据。郑州为默认城市，包含精细模型、详细介绍与电影级运镜脚本；
// 其他预置城市使用 OSM 建筑 + 自动生成的运镜；任意城市可通过搜索动态生成。
// 景点实用信息（开放时间/门票）仅供参考，以景区官方公告为准。

export const ZHENGZHOU = {
  id: 'zhengzhou',
  name: '郑州',
  en: 'Zhengzhou',
  province: '河南',
  slogan: '天地之中 · 华夏之源',
  center: [113.69, 34.765],
  elevation: 100,
  utcOffset: 8,
  cover: 'linear-gradient(135deg,#7a1f1f,#c07a2b)',
  desc: '河南省会，八大古都之一；商代都城遗址与现代郑东新区交相辉映，西望嵩山，北临黄河。',
  guide: { city: '郑州', en: 'Zhengzhou' },
  start: { lon: 113.675, lat: 34.758, distance: 4600, heading: 55, pitch: 21 },
  landmarks: [
    {
      id: 'erqi',
      name: '二七纪念塔',
      en: 'Erqi Memorial Tower',
      kicker: '城市地标 · 红色记忆',
      icon: '🗼',
      lon: 113.6604,
      lat: 34.75334,
      height: 70,
      models: [{ model: 'erqi', lon: 113.6604, lat: 34.75334 }],
      wiki: '二七纪念塔',
      intro:
        '二七纪念塔全称“郑州二七大罢工纪念塔”，1971 年建成，为纪念 1923 年 2 月 7 日京汉铁路工人大罢工而建。塔高 63 米、共 14 层（3 层塔基 + 11 层塔身），平面由东西并联的两个五边形组成——从东西方向看是一座塔，从南北方向看却是双塔。每层都覆有绿色琉璃瓦飞檐，塔顶钟楼设六面大钟，整点奏响《东方红》，最顶端是 9 米旗杆与红五星。\n\n它矗立在二七广场中央，是郑州最具辨识度的城市坐标，周围的德化街、二七商圈是本地最热闹的老商业中心。',
      facts: { 建成: '1971 年', 规模: '高 63 米 · 14 层', 位置: '二七区 · 二七广场', 门票: '免费（塔内为二七纪念馆，需预约）', 开放: '通常周一闭馆' },
      tips: ['塔内可登顶俯瞰二七商圈，展陈讲述“二七”大罢工历史。', '傍晚后塔身亮灯，德化街步行街北口是经典机位。', '步行 10 分钟可到郑州火车站、华润万象城。'],
      view: { distance: 420, heading: 20, pitch: 22 },
      walk: { lon: 113.66035, lat: 34.75255, heading: 0 },
      orbit: { radius: 150, height: 70 },
    },
    {
      id: 'museum',
      name: '河南博物院',
      en: 'Henan Museum',
      kicker: '国家一级博物馆',
      icon: '🏛',
      lon: 113.66617,
      lat: 34.78944,
      height: 55,
      models: [{ model: 'museum', lon: 113.66617, lat: 34.78944, rotation: 0 }],
      wiki: '河南博物院',
      intro:
        '河南博物院始建于 1927 年，是中国建立较早的博物馆之一。现主展馆造型以登封元代观星台为原型，呈金字塔形，冠部“上扬下覆”，外墙取黄河黄土的颜色，寓意“中原之气”。\n\n馆藏文物 17 万余件（套），史前与夏商周青铜器、历代陶瓷玉器尤为精彩。贾湖骨笛、莲鹤方壶、妇好鸮尊、云纹铜禁、武则天金简、杜岭方鼎等都是必看的镇馆之宝；“华夏古乐”演出用复原古乐器演奏，值得专门安排时间。',
      facts: { 始建: '1927 年', 馆藏: '17 万余件（套）', 位置: '金水区 农业路 8 号', 门票: '免费（需提前实名预约）', 开放: '通常周一闭馆' },
      tips: ['节假日预约紧张，建议提前 3–7 天预约。', '“华夏古乐”演出场次有限，入馆后先确认当天时间。', '附近的郑州市动物园、紫荆山公园可顺路游览。'],
      view: { distance: 520, heading: 10, pitch: 28 },
      walk: { lon: 113.66617, lat: 34.78845, heading: 0 },
      orbit: { radius: 220, height: 90 },
    },
    {
      id: 'shang',
      name: '郑州商城遗址',
      en: 'Shang City Ruins',
      kicker: '3600 年前的王都',
      icon: '🏺',
      lon: 113.68445,
      lat: 34.7532,
      height: 30,
      models: [{ model: 'shangwalls', lon: 113.68445, lat: 34.7532 }],
      wiki: '郑州商城遗址',
      intro:
        '郑州商城是距今约 3600 年的商代早期都城遗址，1961 年被列为第一批全国重点文物保护单位，学界多认为它就是商汤所建的“亳都”。内城城墙周长近 7 公里，以夯土逐层筑成，至今仍有多段残垣立于市区之中——城东路、顺城街一带的“城墙遗址公园”可以近距离看到夯土层理。\n\n在高楼林立的老城区里行走于三千多年前的城墙上，是郑州最独特的体验之一。',
      facts: { 年代: '商代早期（约前 16 世纪）', 保护: '第一批全国重点文物保护单位', 位置: '管城回族区 城东路 / 顺城街', 门票: '城墙遗址公园免费' },
      tips: ['推荐沿城东路城墙遗址公园步行，一路可到城隍庙与文庙。', '紫荆山公园内也保留有一段城墙残段。'],
      view: { distance: 900, heading: 340, pitch: 35 },
      walk: { lon: 113.6838, lat: 34.7515, heading: 10 },
      orbit: { radius: 300, height: 120 },
    },
    {
      id: 'chenghuang',
      name: '郑州城隍庙',
      en: 'Zhengzhou City God Temple',
      kicker: '明代古建筑群',
      icon: '⛩',
      lon: 113.68092,
      lat: 34.75341,
      height: 28,
      models: [{ model: 'chenghuang', lon: 113.68092, lat: 34.75341 }],
      wiki: '郑州城隍庙',
      intro:
        '郑州城隍庙始建于明代初年，是郑州市区保存较完整的古建筑群。中轴线上依次排列山门、戏楼、大殿、寝殿等建筑，屋脊上的琉璃脊饰、檐下的木雕斗拱都相当精美。\n\n城隍庙紧邻商城遗址城墙与郑州文庙，三者串联起老城“管城”的千年文脉。',
      facts: { 始建: '明代', 位置: '管城回族区 商城路', 门票: '免费或低价（以现场为准）' },
      tips: ['与文庙、商城遗址可安排成半日步行线路。', '书院街、商城路一带有不少本地小吃。'],
      view: { distance: 320, heading: 15, pitch: 32 },
      walk: { lon: 113.68075, lat: 34.75265, heading: 20 },
      orbit: { radius: 120, height: 55 },
    },
    {
      id: 'cbd',
      name: '郑东新区 CBD · 如意湖',
      en: 'Zhengdong CBD & Ruyi Lake',
      kicker: '现代郑州的名片',
      icon: '🌽',
      lon: 113.72111,
      lat: 34.77192,
      height: 300,
      models: [
        { model: 'dayumi', lon: 113.721107, lat: 34.771916 },
        { model: 'convention', lon: 113.72281, lat: 34.77069 },
        { model: 'artcenter', lon: 113.7178, lat: 34.7721 },
      ],
      wiki: '郑州绿地中心千玺广场',
      intro:
        '郑东新区自 2003 年开始建设，总体规划由日本建筑师黑川纪章主持。CBD 呈同心圆布局，中心是如意湖与会展中心，平面形如一柄“如意”。\n\n湖畔的郑州绿地中心·千玺广场高 280 米，外形取意登封嵩岳寺塔，立面的金属格栅像一粒粒玉米，被市民亲切地称为“大玉米”，夜晚的灯光秀是郑州最有名的夜景之一。旁边的郑州国际会展中心以“伞形”屋顶和桅杆斜拉索为特征；河南艺术中心的五座蛋形建筑造型源自古乐器“陶埙”。',
      facts: { 千玺广场: '高 280 米', 规划: '黑川纪章（郑东新区总体规划）', 位置: '金水区 如意湖畔', 最佳时间: '日落后 1 小时（灯光秀）' },
      tips: ['如意湖北岸与会展中心之间是拍“大玉米”倒影的好机位。', '晚上可以沿湖夜跑，或去附近的商场吃饭。', '地铁 1 号线会展中心站下车。'],
      view: { distance: 1400, heading: 220, pitch: 30 },
      walk: { lon: 113.7195, lat: 34.7706, heading: 45 },
      orbit: { radius: 650, height: 300 },
    },
    {
      id: 'futa',
      name: '中原福塔',
      en: 'Zhongyuan Tower',
      kicker: '世界最高全钢结构电视塔',
      icon: '📡',
      lon: 113.722807,
      lat: 34.724677,
      height: 395,
      models: [{ model: 'futa', lon: 113.722807, lat: 34.724677 }],
      wiki: '中原福塔',
      intro:
        '中原福塔即河南广播电视塔，总高 388 米，由塔座、塔身、塔楼和桅杆四部分组成（塔主体 268 米 + 桅杆 120 米），是世界上最高的全钢结构电视塔，由同济大学建筑设计研究院设计。\n\n塔座取意“鼎立中原”，塔身外立面呈双曲抛物面，从空中俯瞰宛如一朵绽放的梅花。登上塔楼观光层可以 360° 俯瞰郑州，天气好时能远眺郑东新区与黄河方向。',
      facts: { 高度: '388 米（主体 268 + 桅杆 120）', 结构: '全钢结构', 位置: '管城回族区 航海东路', 门票: '观光层收费（以官方为准）' },
      tips: ['傍晚登塔可以看日落和城市亮灯两种景色。', '高空户外项目需按规定穿戴安全装备。'],
      view: { distance: 1200, heading: 200, pitch: 18 },
      walk: { lon: 113.72281, lat: 34.72395, heading: 0 },
      orbit: { radius: 420, height: 260 },
    },
    {
      id: 'yanhuang',
      name: '黄河风景名胜区 · 炎黄二帝',
      en: 'Yellow River Scenic Area',
      kicker: '母亲河畔',
      icon: '🗿',
      lon: 113.510952,
      lat: 34.951276,
      height: 70,
      models: [{ model: 'yanhuang', lon: 113.510952, lat: 34.951276, rotation: 159 }],
      wiki: '炎黄二帝巨型塑像',
      intro:
        '黄河风景名胜区位于郑州西北约 30 公里的邙山，北临黄河。景区标志炎黄二帝巨型塑像雕刻在向阳山上，背依邙山、面向黄河，整体高 106 米（山体 55 米、像高 51 米），高者为炎帝、矮者为黄帝，历时约二十年于 2007 年建成，是华夏儿女寻根拜祖的象征。\n\n景区内还有五龙峰、岳山寺、黄河碑林、哺育雕像等景点，登上山顶可以眺望宽阔的黄河河道与河滩湿地。',
      facts: { 塑像高度: '106 米（山体 55 + 像高 51）', 建成: '2007 年', 位置: '惠济区 邙山 向阳山', 门票: '收费（以官方为准）', 建议游玩: '半天' },
      tips: ['秋季天气通透时远眺黄河最壮观。', '距市区约 30 公里，建议自驾或打车。'],
      view: { distance: 700, heading: 200, pitch: 16 },
      walk: { lon: 113.5117, lat: 34.9533, heading: 200 },
      orbit: { radius: 380, height: 160 },
    },
    {
      id: 'onlyhenan',
      name: '只有河南 · 戏剧幻城',
      en: 'Only Henan · Theater City',
      kicker: '沉浸式戏剧聚落',
      icon: '🎭',
      lon: 113.9935,
      lat: 34.8,
      height: 60,
      models: [],
      wiki: '只有河南·戏剧幻城',
      intro:
        '只有河南·戏剧幻城由王潮歌担任总导演，2021 年开城，位于郑州与开封之间的中牟。整座“城”以黄土为基调，由几十个格子空间与 21 个剧场组成，“幻城剧场”“李家村剧场”“火车站剧场”等围绕黄河、土地与粮食讲述河南的故事，一天之内看不完是常态。',
      facts: { 开城: '2021 年', 规模: '21 个剧场', 位置: '中牟县 郑开大道旁', 建议游玩: '一整天' },
      tips: ['提前查好各剧场场次，按时间规划动线。', '三个主剧场人气最高，建议优先安排。'],
      view: { distance: 1300, heading: 200, pitch: 35 },
      walk: { lon: 113.9935, lat: 34.7982, heading: 0 },
      orbit: { radius: 600, height: 300 },
    },
    {
      id: 'shaolin',
      name: '嵩山少林寺',
      en: 'Shaolin Temple',
      kicker: '世界文化遗产 · 禅宗祖庭',
      icon: '🥋',
      lon: 112.9352,
      lat: 34.5082,
      height: 45,
      models: [
        { model: 'shaolin', lon: 112.9352, lat: 34.5082, preloadRadius: 300 },
        { model: 'talin', lon: 112.9313, lat: 34.5048, preloadRadius: 150 },
      ],
      wiki: '少林寺',
      intro:
        '少林寺位于登封嵩山少室山下，始建于北魏太和十九年（495 年），是汉传佛教禅宗祖庭与少林功夫的发源地。2010 年，包括少林寺常住院、初祖庵与塔林在内的“登封‘天地之中’历史建筑群”被列入世界文化遗产。\n\n常住院中轴线上依次是山门、天王殿、大雄宝殿、法堂、方丈室、立雪亭与千佛殿；寺西的塔林保存着唐代至清代的历代高僧墓塔两百余座，是中国现存规模最大的塔林。',
      facts: { 始建: '北魏太和十九年（495 年）', 遗产: '世界文化遗产（2010）', 位置: '登封市 嵩山少室山', 距市区: '约 80 公里' },
      tips: ['武术表演在景区内的演武厅按场次进行。', '可顺道游览嵩阳书院、中岳庙与观星台。'],
      view: { distance: 1100, heading: 200, pitch: 25 },
      walk: { lon: 112.9357, lat: 34.5068, heading: 15 },
      orbit: { radius: 420, height: 180 },
    },
  ],
  // 电影级运镜：位置为 [经度, 纬度, 离地高度]；orbit 以景点为中心旋转
  cinematic: [
    { type: 'path', dur: 11, tod: 6.7, title: ['郑州', '天地之中 · 华夏之源'], pos: [[113.585, 35.0, 2300], [113.61, 34.965, 1600], [113.635, 34.93, 1250]], look: [[113.66, 34.8, 0], [113.66, 34.78, 0]] },
    { type: 'orbit', dur: 11, tod: 7.4, spot: 'yanhuang', radius: [460, 300], height: [150, 70], az: [-15, 45], caption: ['母亲河畔', '黄河风景名胜区', '炎黄二帝巨塑背依邙山、面向黄河，整体高 106 米。'] },
    { type: 'path', dur: 10, tod: 9.2, spot: 'museum', pos: [[113.658, 34.774, 520], [113.6635, 34.7795, 300], [113.6658, 34.7835, 170]], look: [[113.66617, 34.7897, 25]], caption: ['国家一级博物馆', '河南博物院', '以元代观星台为原型的主展馆里，珍藏着贾湖骨笛、莲鹤方壶等华夏瑰宝。'] },
    { type: 'orbit', dur: 12, tod: 10.6, spot: 'erqi', radius: [260, 170], height: [175, 120], az: [150, 250], caption: ['城市地标', '二七纪念塔', '63 米双身联体塔，东西看是一座，南北看是两座，整点奏响《东方红》。'] },
    { type: 'path', dur: 9, tod: 13, spot: 'shang', pos: [[113.6925, 34.7445, 330], [113.6918, 34.7505, 290], [113.6905, 34.7565, 270]], look: [[113.6842, 34.7485, 0], [113.6835, 34.7525, 0], [113.6812, 34.7548, 10]], caption: ['3600 年前的王都', '商城遗址 · 城隍庙', '夯土城墙静卧在高楼之间，城隍庙的琉璃脊饰诉说着明代的繁华。'] },
    { type: 'orbit', dur: 14, tod: 16.9, spot: 'cbd', radius: [980, 560], height: [480, 240], az: [200, 300], caption: ['如意湖畔', '郑东新区', '280 米的“大玉米”与如意湖、会展中心、艺术中心，构成现代郑州的天际线。'] },
    { type: 'orbit', dur: 10, tod: 17.9, spot: 'futa', radius: [520, 420], height: [70, 330], az: [20, 85], caption: ['388 米', '中原福塔', '世界最高的全钢结构电视塔，俯瞰如一朵盛开的梅花。'] },
    { type: 'orbit', dur: 9, tod: 18.1, spot: 'onlyhenan', radius: [820, 640], height: [420, 330], az: [170, 230], caption: ['沉浸式戏剧聚落', '只有河南 · 戏剧幻城', '21 个剧场讲述黄河、土地与粮食的故事。'] },
    { type: 'path', dur: 12, tod: 17.4, spot: 'shaolin', pos: [[112.99, 34.46, 1400], [112.955, 34.487, 650], [112.94, 34.5, 230]], look: [[112.94, 34.52, 300], [112.935, 34.508, 20]], caption: ['天下功夫出少林', '嵩山少林寺', '禅宗祖庭与塔林静坐少室山下，2010 年列入世界文化遗产。'] },
    { type: 'orbit', dur: 13, tod: 19.9, spot: 'cbd', radius: [2100, 1500], height: [1100, 760], az: [250, 320], title: ['欢迎来到郑州', '点击景点提示符 · 开始你的探索'] },
  ],
};

const L = (id, name, lon, lat, intro, extra = {}) => ({ id, name, lon, lat, intro, height: extra.height ?? 60, icon: extra.icon ?? '📍', kicker: extra.kicker ?? '热门景点', wiki: extra.wiki ?? name, en: extra.en, facts: extra.facts, models: [], orbit: { radius: extra.orbit ?? 350, height: extra.orbitH ?? 180 }, view: { distance: extra.view ?? 900, heading: 200, pitch: 28 } });

export const PRESET_CITIES = [
  ZHENGZHOU,
  {
    id: 'beijing', name: '北京', en: 'Beijing', province: '北京', slogan: '中轴线上的千年帝都', center: [116.397, 39.912], elevation: 45, cover: 'linear-gradient(135deg,#8b1d1d,#d4a035)',
    desc: '六朝古都，中轴线串起故宫、天安门与鸟巢。', guide: { city: '北京', en: 'Beijing' },
    landmarks: [
      L('gugong', '故宫博物院', 116.39078, 39.91743, '明清两代皇宫，始建于明永乐四年（1406 年），1420 年建成，是世界上现存规模最大、保存最完整的木结构宫殿建筑群之一，1987 年列入世界文化遗产。', { icon: '🏯', height: 50, en: 'Palace Museum', orbit: 700, orbitH: 320, view: 1500 }),
      L('tiananmen', '天安门广场', 116.39144, 39.90272, '世界上最大的城市广场之一，北侧为天安门城楼，周边有人民英雄纪念碑、人民大会堂与中国国家博物馆。', { icon: '🚩', height: 40 }),
      L('jingshan', '景山公园', 116.3904, 39.92446, '位于故宫正北，登上万春亭可以俯瞰紫禁城中轴线全景。', { icon: '⛰', height: 60 }),
      L('tiantan', '天坛', 116.40287, 39.87991, '明清两代皇帝祭天祈谷之所，始建于明永乐十八年（1420 年），祈年殿为标志性建筑，1998 年列入世界文化遗产。', { icon: '🛕', height: 45, orbit: 500 }),
      L('niaochao', '国家体育场（鸟巢）', 116.3965, 39.9929, '2008 年北京奥运会主体育场，钢结构编织外形被称为“鸟巢”，也是 2022 年冬奥会开闭幕式场地。', { icon: '🏟', height: 80, wiki: '国家体育场' }),
      L('cctv', '中央电视台总部大楼', 116.45739, 39.91382, '由大都会建筑事务所（OMA）设计，两座倾斜塔楼在顶部以悬挑相连，高 234 米。', { icon: '🏙', height: 250 }),
      L('yiheyuan', '颐和园', 116.26474, 39.9901, '清代皇家园林，以昆明湖与万寿山为基址，1998 年列入世界文化遗产。', { icon: '🌸', height: 80, orbit: 800, orbitH: 380, view: 1800 }),
    ],
  },
  {
    id: 'shanghai', name: '上海', en: 'Shanghai', province: '上海', slogan: '黄浦江两岸的百年天际线', center: [121.492, 31.236], elevation: 5, cover: 'linear-gradient(135deg,#123a6b,#58a6c7)',
    desc: '外滩万国建筑与陆家嘴摩天楼隔江相望。', guide: { city: '上海', en: 'Shanghai' },
    landmarks: [
      L('bund', '外滩', 121.4902, 31.2398, '黄浦江西岸汇集数十栋 20 世纪初的欧式历史建筑，被称为“万国建筑博览群”，对岸即陆家嘴天际线。', { icon: '🌃', height: 50, en: 'The Bund' }),
      L('oriental', '东方明珠', 121.49526, 31.24195, '高 468 米的广播电视塔，1994 年建成，大小球体串联的造型取意“大珠小珠落玉盘”。', { icon: '🗼', height: 480, orbit: 600, orbitH: 380, view: 1600, wiki: '东方明珠广播电视塔' }),
      L('shtower', '上海中心大厦', 121.50125, 31.23564, '高 632 米，是中国最高的建筑，外形呈旋转上升的螺旋。', { icon: '🏙', height: 650, orbit: 700, orbitH: 450, view: 2000 }),
      L('yuyuan', '豫园', 121.48798, 31.22893, '始建于明代的江南古典园林，周边豫园商城与城隍庙是老上海风情的集中地。', { icon: '🏮', height: 30 }),
      L('nanjingrd', '南京路步行街', 121.4753, 31.23768, '上海最著名的商业街之一，东端直通外滩。', { icon: '🛍', height: 40 }),
      L('wukang', '武康大楼', 121.43373, 31.20626, '1924 年建成、由邬达克设计的公寓楼，因“熨斗”般的外形成为热门打卡地。', { icon: '🏢', height: 40 }),
    ],
  },
  {
    id: 'xian', name: '西安', en: "Xi'an", province: '陕西', slogan: '十三朝古都 · 丝路起点', center: [108.946, 34.255], elevation: 400, cover: 'linear-gradient(135deg,#5b2a12,#c98a3c)',
    desc: '城墙、钟楼与大雁塔见证周秦汉唐的辉煌。', guide: { city: '西安', en: "Xi'an" },
    landmarks: [
      L('zhonglou', '西安钟楼', 108.94234, 34.26101, '建于明洪武十七年（1384 年），位于古城中心，是中国现存规模最大、保存最完整的钟楼之一。', { icon: '🔔', height: 45, wiki: '西安钟楼' }),
      L('yongning', '永宁门（南门）', 108.9474, 34.2513, '西安城墙的正南门。城墙为明代在唐皇城基础上扩建，是中国现存最完整的古代城垣之一。', { icon: '🏯', height: 40, wiki: '西安城墙' }),
      L('huimin', '回民街', 108.93893, 34.26337, '钟鼓楼西北侧的美食街区，羊肉泡馍、肉夹馍、甑糕等小吃云集。', { icon: '🍜', height: 30 }),
      L('dayanta', '大雁塔', 108.95943, 34.2198, '唐永徽三年（652 年）玄奘为保存佛经主持修建，2014 年作为丝绸之路遗产点列入世界文化遗产。', { icon: '🛕', height: 70 }),
      L('budiye', '大唐不夜城', 108.95998, 34.21549, '以大雁塔为起点的仿唐步行街区，以夜景与街头演艺闻名。', { icon: '🏮', height: 40 }),
      L('daming', '大明宫国家遗址公园', 108.95851, 34.29389, '唐代大明宫遗址，丝绸之路世界文化遗产的组成部分。', { icon: '🏛', height: 40, orbit: 700 }),
    ],
  },
  {
    id: 'luoyang', name: '洛阳', en: 'Luoyang', province: '河南', slogan: '千年帝都 · 牡丹花城', center: [112.46, 34.65], elevation: 150, cover: 'linear-gradient(135deg,#6a1a4a,#d77aa3)',
    desc: '龙门石窟、白马寺与隋唐洛阳城遗址。', guide: { city: '洛阳', en: 'Luoyang' },
    landmarks: [
      L('longmen', '龙门石窟', 112.47071, 34.55712, '开凿于北魏至唐代，现存窟龛 2300 余个、造像 10 万余尊，卢舍那大佛为代表，2000 年列入世界文化遗产。', { icon: '🗿', height: 60, orbit: 500 }),
      L('yingtian', '应天门', 112.4513, 34.6778, '隋唐洛阳城宫城正门，现为遗址保护展示建筑，夜间灯光秀闻名。', { icon: '🏯', height: 50 }),
      L('mingtang', '天堂明堂', 112.4480, 34.6853, '武则天时期明堂与天堂遗址上的保护展示建筑。', { icon: '🛕', height: 90, wiki: '明堂 (洛阳)' }),
      L('lijing', '丽景门', 112.46232, 34.68314, '洛阳老城西门，城楼下的老城十字街是美食聚集地。', { icon: '🏮', height: 35 }),
      L('baima', '白马寺', 112.59814, 34.72433, '始建于东汉永平十一年（68 年），被誉为“中国第一古刹”。', { icon: '🐎', height: 40 }),
    ],
  },
  {
    id: 'kaifeng', name: '开封', en: 'Kaifeng', province: '河南', slogan: '一城宋韵 · 八朝古都', center: [114.35, 34.8], elevation: 75, cover: 'linear-gradient(135deg,#3b2d10,#c5a55a)',
    desc: '《清明上河图》里的东京汴梁。', guide: { city: '开封', en: 'Kaifeng' },
    landmarks: [
      L('qingming', '清明上河园', 114.3380, 34.8120, '依据张择端《清明上河图》复原建造的宋文化主题公园。', { icon: '🎎', height: 40 }),
      L('longting', '龙亭', 114.3488, 34.8108, '建于明代周王府遗址上，北宋皇宫亦在此一带，湖光殿影相映。', { icon: '🏯', height: 45, wiki: '龙亭公园' }),
      L('tieta', '开封铁塔', 114.36487, 34.81663, '北宋皇祐元年（1049 年）建成的琉璃砖塔，通体褐色琉璃砖似铁色而得名。', { icon: '🗼', height: 60 }),
      L('xiangguo', '大相国寺', 114.34878, 34.79265, '始建于北齐，北宋时为皇家寺院，“相国霜钟”为汴京八景之一。', { icon: '🔔', height: 40 }),
      L('kaifengfu', '开封府', 114.34111, 34.79056, '依北宋开封府官署复建，包拯曾任开封府尹。', { icon: '⚖', height: 35 }),
    ],
  },
  {
    id: 'hangzhou', name: '杭州', en: 'Hangzhou', province: '浙江', slogan: '上有天堂 · 下有苏杭', center: [120.15, 30.25], elevation: 10, cover: 'linear-gradient(135deg,#0f4c46,#7cc3a3)',
    desc: '西湖山水与千年古刹。', guide: { city: '杭州', en: 'Hangzhou' },
    landmarks: [
      L('duanqiao', '断桥残雪', 120.14737, 30.26153, '西湖十景之一，白堤东端的断桥因《白蛇传》传说而闻名。', { icon: '🌉', height: 30, wiki: '断桥' }),
      L('santan', '三潭印月', 120.1405, 30.24082, '西湖十景之一，湖中三座石塔映月成景。', { icon: '🌕', height: 30 }),
      L('leifeng', '雷峰塔', 120.14501, 30.23388, '始建于北宋（977 年），1924 年倒塌，2002 年重建新塔。', { icon: '🛕', height: 70 }),
      L('lingyin', '灵隐寺', 120.09763, 30.2424, '始建于东晋咸和元年（326 年），是杭州最早的名刹之一，旁有飞来峰造像群。', { icon: '🙏', height: 45 }),
      L('hefang', '河坊街', 120.16991, 30.24214, '清河坊历史街区，老字号与小吃聚集。', { icon: '🏮', height: 30 }),
      L('lianhua', '杭州奥体中心体育场', 120.22549, 30.23171, '2023 年杭州亚运会主场馆，外形如“莲花碗”，俗称“大莲花”。', { icon: '🏟', height: 70 }),
    ],
  },
  {
    id: 'chengdu', name: '成都', en: 'Chengdu', province: '四川', slogan: '一座来了就不想走的城市', center: [104.066, 30.66], elevation: 500, cover: 'linear-gradient(135deg,#1d4d1d,#9bcf6a)',
    desc: '三国文化、熊猫与市井烟火。', guide: { city: '成都', en: 'Chengdu' },
    landmarks: [
      L('kuanzhai', '宽窄巷子', 104.0543, 30.6693, '由宽巷子、窄巷子、井巷子三条平行老街组成的清代街区。', { icon: '🏮', height: 30 }),
      L('wuhou', '武侯祠', 104.04566, 30.64784, '纪念诸葛亮的祠庙，与刘备惠陵、汉昭烈庙合一，是全国唯一的君臣合祀祠庙。', { icon: '⛩', height: 30, wiki: '成都武侯祠' }),
      L('jinli', '锦里', 104.0487, 30.6454, '紧邻武侯祠的仿古商业街，川西民俗与小吃集中。', { icon: '🍢', height: 30 }),
      L('dufu', '杜甫草堂', 104.02623, 30.66285, '唐代诗人杜甫流寓成都时的故居。', { icon: '📜', height: 30 }),
      L('chunxi', '春熙路 · 太古里', 104.0801, 30.6559, '成都最繁华的商业街区之一，与太古里相邻。', { icon: '🛍', height: 50, wiki: '春熙路' }),
      L('panda', '大熊猫繁育研究基地', 104.13293, 30.74323, '观看大熊猫与小熊猫的热门去处，建议清晨入园。', { icon: '🐼', height: 40, wiki: '成都大熊猫繁育研究基地' }),
    ],
  },
];

/** 为没有手写脚本的城市自动生成运镜：高空开场 → 逐个景点环绕 → 收尾 */
export function autoCinematic(city) {
  const lm = city.landmarks.slice(0, 6);
  const [lon, lat] = city.center;
  const shots = [
    { type: 'orbit', dur: 10, tod: 7.2, center: [lon, lat], radius: [5200, 4200], height: [2600, 1900], az: [180, 230], title: [city.name, city.slogan || city.province || ''] },
  ];
  const tods = [9, 10.5, 12, 14.5, 16.5, 17.6];
  lm.forEach((l, i) => {
    const r = l.orbit?.radius ?? 350;
    const h = l.orbit?.height ?? 180;
    shots.push({ type: 'orbit', dur: 9, tod: tods[i % tods.length], spot: l.id, radius: [r * 1.35, r], height: [h * 1.3, h * 0.8], az: [150 + i * 40, 230 + i * 40], caption: [l.kicker || '热门景点', l.name, (l.intro || '').split('。')[0] + '。'] });
  });
  shots.push({ type: 'orbit', dur: 11, tod: 19.8, center: [lon, lat], radius: [3200, 2500], height: [1500, 1100], az: [240, 300], title: [`欢迎来到${city.name}`, '点击景点提示符 · 开始你的探索'] });
  return shots;
}

/** 由搜索结果 + 自动景点构建一个城市对象 */
export function cityFromSearch(place, attractions) {
  return {
    id: `custom-${place.lat.toFixed(3)}-${place.lon.toFixed(3)}`,
    name: place.name,
    en: place.nameEn || '',
    province: (place.display || '').split(',').slice(-3, -2)[0]?.trim() || '',
    slogan: '探索这座城市',
    center: [place.lon, place.lat],
    elevation: 50,
    desc: place.display,
    guide: { city: place.name, en: place.nameEn || place.name },
    landmarks: attractions.map((a, i) => ({
      id: `a${i}`,
      name: a.name,
      en: a.nameEn,
      lon: a.lon,
      lat: a.lat,
      icon: '📍',
      kicker: '热门景点',
      height: 60,
      wiki: a.wiki ? a.wiki.replace(/^\w+:/, '') : a.name,
      wikiLang: a.wiki && !a.wiki.startsWith('zh:') ? a.wiki.split(':')[0] : 'zh',
      intro: '',
      models: [],
      orbit: { radius: 350, height: 180 },
      view: { distance: 900, heading: 200, pitch: 28 },
    })),
    custom: true,
  };
}
