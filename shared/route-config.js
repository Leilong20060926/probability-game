// 三地圖路段版（route-v1）的設定。地圖與路段需求是資料，不寫死在規則邏輯裡。

export const RULESET = 'route-v1';
export const ROUTE_VERSION = '0.5.0';

export const ROAD_TYPES = ['H', 'V', 'B', 'X'];
export const DECK_TYPES = ['H', 'V', 'B', 'X', 'R'];
export const NEED_TYPES = ['H', 'V', 'B'];

export const SEGMENTS = {
  HH: { H: 2, V: 0, B: 0 },
  HV: { H: 1, V: 1, B: 0 },
  V: { H: 0, V: 1, B: 0 },
  VV: { H: 0, V: 2, B: 0 },
  H: { H: 1, V: 0, B: 0 },
  B: { H: 0, V: 0, B: 1 },
};

export const BASE_CONFIG = Object.freeze({
  deck: { H: 4, V: 4, B: 2, X: 1, R: 5 },
  handLimit: 5,
  digBase: 3,
  // 每一段的落石加需求 a 最多到幾張；之後再抽到的落石照樣翻開移出，但不再加需求。
  // 3 張時最大付款為 2+3=5，不會超過手牌上限而卡死。null 表示不設上限（0.4.0 舊規則）。
  maxRockCost: 3,
  allowDig: true,
  forceBranch: null,
  goldScore: 60,
  coinScore: 20,
  maxMaps: 3,
  timeLimitMs: 300_000,
  maps: {
    1: { first: 'HH', A: ['B', 'HV', 'V'], B: ['HH', 'HV'] },
    2: { first: 'HV', A: ['B', 'HH', 'H'], B: ['VV', 'H', 'H'] },
    3: { first: 'B', A: ['HH', 'VV', 'V'], B: ['VV', 'B', 'VV'] },
  },
});

// 命令列比較情境；只用於精算，不會改到正式遊戲設定。
export const SCENARIOS = {
  base: {},
  rocks4: { deck: { R: 4 } },
  forceA: { forceBranch: 'A' },
  forceB: { forceBranch: 'B' },
  hand4: { handLimit: 4 },
  noDig: { allowDig: false },
  noRockCap: { maxRockCost: null },
  map1BHVHV: { maps: { 1: { B: ['HV', 'HV'] } } },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// FNV-1a 64-bit；瀏覽器與 Node 都能同步計算，只用來辨識設定，不是安全雜湊。
function fnv1a64(text) {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export function validateConfig(config) {
  const errors = [];
  for (const t of DECK_TYPES) {
    if (!Number.isInteger(config.deck[t]) || config.deck[t] < 0) errors.push(`deck.${t} 必須是非負整數`);
  }
  if (!Number.isInteger(config.handLimit) || config.handLimit < 1) errors.push('handLimit 必須是正整數');
  if (!Number.isInteger(config.digBase) || config.digBase < 1) errors.push('digBase 必須是正整數');
  if (config.maxRockCost !== null && (!Number.isInteger(config.maxRockCost) || config.maxRockCost < 0)) errors.push('maxRockCost 必須是非負整數或 null');
  if (![null, 'A', 'B'].includes(config.forceBranch)) errors.push('forceBranch 必須是 null、A 或 B');
  for (const id of ['1', '2', '3']) {
    const map = config.maps[id];
    if (!map) { errors.push(`缺少地圖 ${id}`); continue; }
    for (const seg of [map.first, ...map.A, ...map.B]) {
      if (!SEGMENTS[seg]) errors.push(`地圖 ${id} 使用未知路段 ${seg}`);
    }
    if (!map.A.length || !map.B.length) errors.push(`地圖 ${id} 的 A／B 線不能是空的`);
  }
  if (errors.length) throw new Error(`route config 不合法：${errors.join('；')}`);
  return config;
}

export function makeConfig(patch = {}) {
  const merged = deepMerge(structuredClone(BASE_CONFIG), patch);
  validateConfig(merged);
  const configId = `${RULESET}-${fnv1a64(canonical(merged))}`;
  return Object.freeze({ ...merged, configId });
}

// 再抽到一張落石後的 a（有上限時不超過 maxRockCost）。引擎與精算共用，確保規則一致。
export function addRock(config, a) {
  return config.maxRockCost === null ? a + 1 : Math.min(a + 1, config.maxRockCost);
}

export function scenarioConfig(name) {
  if (!(name in SCENARIOS)) throw new Error(`未知情境 ${name}；可用：${Object.keys(SCENARIOS).join(', ')}`);
  return makeConfig(SCENARIOS[name]);
}

// 路段序列：first → fork → A[0..] / B[0..] → end
export function segmentNeed(config, mapId, pos) {
  const map = config.maps[mapId];
  if (pos.kind === 'first') return SEGMENTS[map.first];
  if (pos.kind === 'A' || pos.kind === 'B') return SEGMENTS[map[pos.kind][pos.index]];
  return null;
}

export function segmentCode(config, mapId, pos) {
  const map = config.maps[mapId];
  if (pos.kind === 'first') return map.first;
  if (pos.kind === 'A' || pos.kind === 'B') return map[pos.kind][pos.index];
  return null;
}

export function nextPosition(config, mapId, pos) {
  const map = config.maps[mapId];
  if (pos.kind === 'first') return { kind: 'fork', index: 0 };
  if (pos.kind === 'A' || pos.kind === 'B') {
    return pos.index + 1 < map[pos.kind].length ? { kind: pos.kind, index: pos.index + 1 } : { kind: 'end', index: 0 };
  }
  throw new Error(`無法從 ${pos.kind} 前進`);
}

export function publicConfig(config) {
  return {
    configId: config.configId,
    deck: { ...config.deck },
    handLimit: config.handLimit,
    digBase: config.digBase,
    maxRockCost: config.maxRockCost,
    allowDig: config.allowDig,
    goldScore: config.goldScore,
    coinScore: config.coinScore,
    maxMaps: config.maxMaps,
    timeLimitMs: config.timeLimitMs,
    maps: structuredClone(config.maps),
    segments: structuredClone(SEGMENTS),
  };
}
