// 꾸준기업 공시 알림용: DART에서 최근 주요 공시를 모아 alerts.json 으로 저장
// GitHub Actions 가 2시간마다 실행합니다 (.github/workflows/alerts.yml).
// 인증키는 GitHub 저장소의 Secrets(DART_KEY)에만 넣습니다. 이 파일에 적지 마세요.
import fs from 'node:fs';

const KEY = process.env.DART_KEY;
if (!KEY) {
  console.log('DART_KEY 가 없습니다. 저장소 Settings → Secrets and variables → Actions 에 DART_KEY 를 넣어 주세요.');
  process.exit(1);
}
const BASE = process.env.DART_BASE || 'https://opendart.fss.or.kr/api';
const KEEP_DAYS = 7;
const OUT = 'alerts.json';

// 앱의 데이터 프로그램과 같은 분류 (앱 주제와 관련된 공시만)
const RULES = [
  ['실적', /사업보고서|반기보고서|분기보고서|영업\(잠정\)실적|매출액또는손익구조/],
  ['배당', /배당/],
  ['자사주', /자기주식|주식소각|이익소각/],
  ['주식 수', /유상증자|무상증자|전환사채|신주인수권부사채|교환사채|감자|주식분할|주식병합/],
  ['사업 변화', /합병|분할|영업양수|영업양도|자산양수|자산양도|타법인주식및출자증권(취득|처분)/],
];
function tagOf(title) {
  const t = title.replace(/\s/g, '');
  if (/임원ㆍ주요주주|대량보유|최대주주등소유주식변동/.test(t)) return null;
  for (const [tag, re] of RULES) if (re.test(t)) return tag;
  return null;
}

// 한국 날짜 (YYYYMMDD)
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function list(params) {
  const qs = new URLSearchParams({ crtfc_key: KEY, ...params });
  const res = await fetch(`${BASE}/list.json?${qs}`);
  const j = await res.json();
  await sleep(200);
  if (j.status === '000') return j;
  if (j.status === '013') return null;
  throw new Error(`DART ${j.status} ${j.message ?? ''}`);
}

const now = new Date();
const bgn = kst(new Date(now.getTime() - 864e5)); // 어제부터 오늘까지
const end = kst(now);

const fresh = [];
for (const cls of ['Y', 'K']) {
  // Y 코스피 · K 코스닥
  for (let page = 1; page <= 30; page++) {
    const j = await list({ bgn_de: bgn, end_de: end, corp_cls: cls, page_no: String(page), page_count: '100' });
    for (const d of j?.list ?? []) {
      if (!d.stock_code) continue;
      const title = (d.report_nm || '').replace(/\s+/g, ' ').trim();
      const tag = tagOf(title);
      if (!tag) continue;
      fresh.push({
        id: d.rcept_no,
        date: `${d.rcept_dt.slice(0, 4)}.${d.rcept_dt.slice(4, 6)}.${d.rcept_dt.slice(6, 8)}`,
        code: d.stock_code,
        name: d.corp_name,
        title,
        tag,
      });
    }
    if (!j || page >= Number(j.total_page || 1)) break;
  }
}

// 예전 것과 합치고 최근 7일만 남김 (새 공시가 위로)
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).items ?? [] : [];
const byId = new Map();
for (const a of [...old, ...fresh]) byId.set(a.id, a);
const cutoff = kst(new Date(now.getTime() - KEEP_DAYS * 864e5));
const items = [...byId.values()]
  .filter((a) => a.id.slice(0, 8) >= cutoff)
  .sort((a, b) => b.id.localeCompare(a.id));

const before = JSON.stringify(old);
if (JSON.stringify(items) === before) {
  console.log('새 공시 없음');
} else {
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: now.toISOString(), items }));
  console.log(`공시 ${items.length}건 저장 (이번에 확인 ${fresh.length}건)`);
}
