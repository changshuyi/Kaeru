// 日本有國際定期航線的機場約 34 座，只放這些，不追求完整——找不到就選
// 「其他機場」，用預設 3 小時。region 是地區 key（對應 AIRPORT_REGIONS），
// city 是機場所在城市，hours 是建議提早幾小時（給總覽倒數區跟回程當天
// 流程第一條用）。機場名稱、城市、地區名都是日文原文地名，中日文介面
// 共用同一份，不分開翻譯——跟機場名稱本身一樣，本來就是專有名詞。
export const AIRPORTS = [
  // 主要樞紐
  { code: 'NRT', name: '成田国際空港', city: '東京', region: 'hub', hours: 3.5 },
  { code: 'HND', name: '東京国際空港', city: '羽田', region: 'hub', hours: 3 },
  { code: 'KIX', name: '関西国際空港', city: '大阪', region: 'hub', hours: 3.5 },
  { code: 'NGO', name: '中部国際空港', city: '名古屋', region: 'hub', hours: 3 },
  { code: 'FUK', name: '福岡空港', city: '福岡', region: 'hub', hours: 3 },
  // 北海道
  { code: 'CTS', name: '新千歳空港', city: '札幌', region: '北海道', hours: 3 },
  { code: 'HKD', name: '函館空港', city: '函館', region: '北海道', hours: 2.5 },
  { code: 'AKJ', name: '旭川空港', city: '旭川', region: '北海道', hours: 2.5 },
  // 東北
  { code: 'SDJ', name: '仙台空港', city: '仙台', region: '東北', hours: 2.5 },
  { code: 'AOJ', name: '青森空港', city: '青森', region: '東北', hours: 2 },
  { code: 'HNA', name: '花巻空港', city: '岩手', region: '東北', hours: 2 },
  { code: 'AXT', name: '秋田空港', city: '秋田', region: '東北', hours: 2 },
  { code: 'FKS', name: '福島空港', city: '福島', region: '東北', hours: 2 },
  // 関東
  { code: 'IBR', name: '茨城空港', city: '茨城', region: '関東', hours: 2 },
  // 中部・北陸
  { code: 'KMQ', name: '小松空港', city: '石川', region: '中部・北陸', hours: 2.5 },
  { code: 'KIJ', name: '新潟空港', city: '新潟', region: '中部・北陸', hours: 2 },
  { code: 'TOY', name: '富山空港', city: '富山', region: '中部・北陸', hours: 2 },
  { code: 'FSZ', name: '静岡空港', city: '静岡', region: '中部・北陸', hours: 2.5 },
  // 関西
  { code: 'UKB', name: '神戸空港', city: '神戸', region: '関西', hours: 2.5 },
  // 中国
  { code: 'OKJ', name: '岡山空港', city: '岡山', region: '中国', hours: 2 },
  { code: 'HIJ', name: '広島空港', city: '広島', region: '中国', hours: 2.5 },
  { code: 'YGJ', name: '米子空港', city: '鳥取', region: '中国', hours: 2 },
  // 四国
  { code: 'TAK', name: '高松空港', city: '香川', region: '四国', hours: 2 },
  { code: 'MYJ', name: '松山空港', city: '愛媛', region: '四国', hours: 2 },
  { code: 'KCZ', name: '高知空港', city: '高知', region: '四国', hours: 2 },
  // 九州
  { code: 'KMJ', name: '熊本空港', city: '熊本', region: '九州', hours: 2 },
  { code: 'KOJ', name: '鹿児島空港', city: '鹿児島', region: '九州', hours: 2.5 },
  { code: 'KMI', name: '宮崎空港', city: '宮崎', region: '九州', hours: 2 },
  { code: 'OIT', name: '大分空港', city: '大分', region: '九州', hours: 2 },
  { code: 'HSG', name: '佐賀空港', city: '佐賀', region: '九州', hours: 2 },
  // 清單頁副標是「北九州」，但搜尋結果頁改標「福岡県 · 北九州」（讓人
  // 知道北九州在福岡縣）——citySearchLabel 只給搜尋結果用，清單分組
  // 瀏覽仍用 city。
  { code: 'KKJ', name: '北九州空港', city: '北九州', citySearchLabel: '福岡県 · 北九州', region: '九州', hours: 2 },
  // 沖縄
  { code: 'OKA', name: '那覇空港', city: '沖縄', region: '沖縄', hours: 2.5 },
  { code: 'ISG', name: '石垣空港', city: '石垣島', region: '沖縄', hours: 2 },
  { code: 'SHI', name: '下地島空港', city: '宮古島', region: '沖縄', hours: 2 },
];

// 地區清單固定順序；chip 是籌碼列的短標籤，header 是清單裡的組標題
// （中部・北陸在籌碼列縮寫成「中部」，主要樞紐的中日文標籤不一樣，
// 其他地區都是日文地名，中日文介面共用）。
export const AIRPORT_REGIONS = [
  { key: 'hub', chip: null, header: null },
  { key: '北海道', chip: '北海道', header: '北海道' },
  { key: '東北', chip: '東北', header: '東北' },
  { key: '関東', chip: '関東', header: '関東' },
  { key: '中部・北陸', chip: '中部', header: '中部・北陸' },
  { key: '関西', chip: '関西', header: '関西' },
  { key: '中国', chip: '中国', header: '中国' },
  { key: '四国', chip: '四国', header: '四国' },
  { key: '九州', chip: '九州', header: '九州' },
  { key: '沖縄', chip: '沖縄', header: '沖縄' },
];
export const DEFAULT_ARRIVE_HOURS = 3; // 選了「其他機場」或沒選，一律預設 3 小時

export function arriveHoursText(t, hours) {
  const h = Math.floor(hours);
  const half = hours - h >= 0.5;
  return half ? `${h} ${t.hours} 30 ${t.min}` : `${h} ${t.hours}`;
}

export function regionLabel(t, region, kind) {
  if (region.key === 'hub') return kind === 'chip' ? t.airportHubChip : t.airportHubHeader;
  return region[kind];
}
