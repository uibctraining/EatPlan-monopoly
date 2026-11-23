/* EatPlan-monopoly · 环马大富翁 — 棋盘与卡牌数据（马来西亚文旅剧情） */
'use strict';

const CFG = {
  CASH: 2500,          // 起始现金 RM
  SALARY: 200,         // 经过起点工资
  TAX_PCT: 0.10,       // SST 消费税：现金 10%
  TAX_FLAT: 200,       // 所得税固定额
  MAX_ROUNDS: 10,      // 结算轮数上限（可在开局选 5/10/15）
  REST_TURNS: 1,       // 茶餐室休息回合数
  LOAN_INTEREST: 0.10, // 还贷利息
  HOUSE_MAX: 3,        // 0=无 1=小贩摊 2=茶室 3=酒店
  HOUSE_COST: null,    // 见 houseCostOf()
  BUY_KEEP: 300,       // AI 买地后保留现金
  PASS_GROUP_MULT: 1.5 // 同组集齐过路费 ×1.5
};

/* 地产分组（同组集齐加成） */
const GROUPS = {
  penang:   { name: '槟城',   color: '#2E7DD1' },
  melaka:   { name: '马六甲', color: '#2F9E63' },
  johor:    { name: '柔佛',   color: '#D64541' },
  kl:       { name: '吉隆坡', color: '#E0A800' },
  sabah:    { name: '沙巴',   color: '#8A5CD1' },
  sarawak:  { name: '砂拉越', color: '#1F9E9E' },
  perak:    { name: '霹雳',   color: '#E07B2E' }
};

/* 28 格棋盘（顺时针）。type: start/land/tax/rest/fortune/chance */
const BOARD = [
  { i: 0,  type: 'start',    name: 'KLIA 起飞', icon: '✈️', desc: '经过领工资 RM200' },
  { i: 1,  type: 'land', name: '茨厂街',     icon: '🏮', price: 60,  group: 'kl' },
  { i: 2,  type: 'fortune',  name: '命运', icon: '❓' },
  { i: 3,  type: 'land', name: '独立广场',   icon: '🗼', price: 80,  group: 'kl' },
  { i: 4,  type: 'sst',      name: 'SST 消费税', icon: '🧾', desc: '付现金 10%' },
  { i: 5,  type: 'land', name: '升旗山',     icon: '⛰️', price: 100, group: 'penang' },
  { i: 6,  type: 'land', name: '乔治市壁画', icon: '🎨', price: 120, group: 'penang' },
  { i: 7,  type: 'rest',     name: '茶餐室',   icon: '☕', desc: '歇一回合 · 掷双可走' },
  { i: 8,  type: 'land', name: '鸡场街',     icon: '🍢', price: 140, group: 'melaka' },
  { i: 9,  type: 'land', name: '圣保罗山',   icon: '⛪', price: 150, group: 'melaka' },
  { i: 10, type: 'chance',   name: '机遇', icon: '🎲' },
  { i: 11, type: 'land', name: '海峡清真寺', icon: '🕌', price: 160, group: 'melaka' },
  { i: 12, type: 'land', name: '乐高乐园',   icon: '🧱', price: 180, group: 'johor' },
  { i: 13, type: 'land', name: '柔佛皇宫',   icon: '👑', price: 190, group: 'johor' },
  { i: 14, type: 'fortune',  name: '命运', icon: '❓' },
  { i: 15, type: 'land', name: '云顶高原',   icon: '🎰', price: 220, group: 'kl' },
  { i: 16, type: 'land', name: '黑风洞',     icon: '🪜', price: 230, group: 'kl' },
  { i: 17, type: 'tax',      name: '所得税',   icon: '💰', desc: '付 RM200' },
  { i: 18, type: 'land', name: '神山公园',   icon: '🏔️', price: 260, group: 'sabah' },
  { i: 19, type: 'land', name: '美人鱼岛',   icon: '🏝️', price: 280, group: 'sabah' },
  { i: 20, type: 'chance',   name: '机遇', icon: '🎲' },
  { i: 21, type: 'land', name: '京那巴鲁河', icon: '🛶', price: 300, group: 'sabah' },
  { i: 22, type: 'land', name: '猫城古晋',   icon: '🐈', price: 320, group: 'sarawak' },
  { i: 23, type: 'land', name: '文化村',     icon: '🛖', price: 330, group: 'sarawak' },
  { i: 24, type: 'rest',     name: '茶餐室',   icon: '☕', desc: '歇一回合 · 掷双可走' },
  { i: 25, type: 'land', name: '芽菜街',     icon: '🥬', price: 350, group: 'perak' },
  { i: 26, type: 'land', name: '三宝洞',     icon: '🗿', price: 365, group: 'perak' },
  { i: 27, type: 'land', name: '金马仑高原', icon: '🍵', price: 380, group: 'perak' }
];
const N = BOARD.length; // 28

/* 房屋/建筑成本与过路费倍率（按地价比例） */
function houseCostOf(tile) { return Math.round(tile.price * 0.5); }
const FEE_MULT = [0.10, 0.25, 0.55, 1.00]; // 0级/小贩摊/茶室/酒店 × 地价（同组再 ×1.5）

/* 命运卡（马来西亚文旅剧情）*/
const FORTUNE = [
  { t: '美食博客爆红！探店视频上热门', d: '流量变现', cash: 150 },
  { t: '雨季航班延误，改签亚航', d: '行程损耗', cash: -80 },
  { t: '开斋节开放门户，受邀到友族家做客', d: '红包 + 直播打赏', cash: 60 },
  { t: '榴莲季自助吃到饱，直播带货成功', d: '猫山王红利', cash: 120 },
  { t: 'LRT 交通卡忘记充值，被闸机拦住', d: '小额破财', cash: -30 },
  { t: '文化节舞台表演爆满，受邀登台', d: '演出费', cash: 100 },
  { t: '护照到期，回城补办加急', d: '证件费', cash: -100 },
  { t: '被选为旅游大使，州政府颁发奖金', d: '荣誉', cash: 200 }
];

/* 机遇卡（含位移/状态效果）*/
const CHANCE = [
  { t: 'Grab 司机绕远路，投诉获赔', d: '补偿金', cash: 50 },
  { t: '夜市摆摊卖叻沙，收摊数钱', d: '小生意', cash: 90 },
  { t: 'LRT 换乘跑太急，摔破眼镜', d: '修配费', cash: -60 },
  { t: '跳上前往吉隆坡的 ETS 列车', d: '直接前往「KLIA 起飞」领工资', move: 0 },
  { t: '市集吃到沙门氏菌，进诊所挂水', d: '医疗费', cash: -120 },
  { t: '房东涨租，押金抵扣', d: '支出', cash: -70 },
  { t: '摄影比赛获奖，奖金入账', d: '奖金', cash: 130 },
  { t: '航班超售，改乘深夜巴士（倒退 3 格）', d: '折返', back: 3 }
];

/* 玩家角色（马来西亚风味）*/
const AVATARS = [
  { key: 'me',    name: '我',      emoji: '🐼', color: '#E0A800' },
  { key: 'fox',   name: '电脑·鹦鹉', emoji: '🦜', color: '#2F9E63' },
  { key: 'pen',   name: '电脑·老虎', emoji: '🐯', color: '#D64541' },
  { key: 'cat',   name: '电脑·猫咪', emoji: '🐱', color: '#8A5CD1' }
];

/* ============ 穷爸爸富爸爸 · 现金流玩法 ============ */

/* 虚拟股票：每轮市场波动，每轮按股息率派息（被动现金流） */
const STOCKS = [
  { id: 'airasia', name: '亚航',      icon: '✈️', base: 100, div: 0.05, vol: 0.12 },
  { id: 'tnb',     name: '国家电网',  icon: '💡', base: 60,  div: 0.08, vol: 0.05 },
  { id: 'genting', name: '云顶集团',  icon: '🎰', base: 140, div: 0.04, vol: 0.15 },
  { id: 'grab',    name: 'Grab 出行', icon: '🚕', base: 80,  div: 0.05, vol: 0.10 }
];

/* 保险：天灾人祸卡出险时按保额理赔（对冲风险） */
const INSURANCE = [
  { id: 'travel', name: '旅游意外险', icon: '🛡️', premium: 60,  term: 6, cover: 300, desc: '意外/天灾出险理赔 RM300' },
  { id: 'health', name: '住院医疗险', icon: '🏥', premium: 100, term: 5, cover: 500, desc: '疾病/意外出险理赔 RM500' }
];

/* 卡牌 kind：disaster=天灾人祸（持对应保险可理赔）· lucky=幸运事件 */

const ROSTER = {
  me:   { name: '我',         emoji: '🐼', color: '#E0A800' },
  fox:  { name: '电脑·鹦鹉',  emoji: '🦜', color: '#2F9E63' },
  tiger:{ name: '电脑·老虎',  emoji: '🐯', color: '#D64541' },
  cat:  { name: '电脑·猫咪',  emoji: '🐱', color: '#8A5CD1' }
};
