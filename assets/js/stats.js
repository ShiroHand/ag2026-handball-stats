/* ==========================================================================
   stats.js — クラスター分析・主成分分析（依存パッケージなし）

   データが小さい（チーム10前後 / チーム×試合40前後）ので、
   外部ライブラリを使わずに素直な実装で足りる。
   ========================================================================== */

/* ---------- 基本統計 ---------- */
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/* 列ごとに標準化（平均0・標準偏差1）。
   単位が違う変数（%と回数）を同じ土俵に乗せるために必要。 */
export function standardize(rows) {
  if (!rows.length) return {z: [], mu: [], sg: []};
  const p = rows[0].length;
  const mu = [], sg = [];
  for (let j = 0; j < p; j++) {
    const col = rows.map(r => r[j]);
    mu.push(mean(col));
    const s = sd(col);
    sg.push(s > 1e-9 ? s : 1);          // 動かない変数は 1 で割る（結果は全部0になる）
  }
  const z = rows.map(r => r.map((v, j) => (v - mu[j]) / sg[j]));
  return {z, mu, sg};
}

/* ---------- k-means ---------- */
const dist2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

/* k-means++ で初期中心を選ぶ（乱数の当たり外れを減らすため） */
function seedPlusPlus(data, k, rnd) {
  const centers = [data[Math.floor(rnd() * data.length)].slice()];
  while (centers.length < k) {
    const d = data.map(p => Math.min(...centers.map(c => dist2(p, c))));
    const tot = d.reduce((a, b) => a + b, 0);
    if (tot <= 0) { centers.push(data[Math.floor(rnd() * data.length)].slice()); continue; }
    let r = rnd() * tot, i = 0;
    while (i < d.length - 1 && (r -= d[i]) > 0) i++;
    centers.push(data[i].slice());
  }
  return centers;
}

/* 再現性のある乱数（同じデータなら毎回同じ結果になるように） */
function lcg(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

export function kmeans(data, k, {restarts = 25, iters = 100} = {}) {
  if (!data.length) return {labels: [], centers: [], inertia: 0};
  k = Math.max(1, Math.min(k, data.length));
  const rnd = lcg(42);
  let best = null;
  for (let r = 0; r < restarts; r++) {
    let centers = seedPlusPlus(data, k, rnd);
    let labels = new Array(data.length).fill(0);
    for (let it = 0; it < iters; it++) {
      let moved = false;
      data.forEach((p, i) => {
        let bi = 0, bd = Infinity;
        centers.forEach((c, ci) => { const d = dist2(p, c); if (d < bd) { bd = d; bi = ci; } });
        if (labels[i] !== bi) { labels[i] = bi; moved = true; }
      });
      const sums = centers.map(() => new Array(data[0].length).fill(0));
      const cnts = centers.map(() => 0);
      data.forEach((p, i) => { cnts[labels[i]]++; p.forEach((v, j) => sums[labels[i]][j] += v); });
      centers = centers.map((c, ci) => (cnts[ci] ? sums[ci].map(v => v / cnts[ci]) : c));
      if (!moved && it > 0) break;
    }
    const inertia = data.reduce((s, p, i) => s + dist2(p, centers[labels[i]]), 0);
    if (!best || inertia < best.inertia) best = {labels: labels.slice(), centers, inertia};
  }
  return best;
}

/* クラスタ数の目安（シルエット係数）。1に近いほどよく分かれている。 */
export function silhouette(data, labels) {
  const k = Math.max(...labels) + 1;
  if (k < 2 || data.length <= k) return null;
  const groups = Array.from({length: k}, () => []);
  labels.forEach((l, i) => groups[l].push(i));
  let tot = 0;
  data.forEach((p, i) => {
    const own = groups[labels[i]];
    if (own.length <= 1) return;
    const a = own.filter(j => j !== i).reduce((s, j) => s + Math.sqrt(dist2(p, data[j])), 0) / (own.length - 1);
    let b = Infinity;
    groups.forEach((g, gi) => {
      if (gi === labels[i] || !g.length) return;
      const d = g.reduce((s, j) => s + Math.sqrt(dist2(p, data[j])), 0) / g.length;
      if (d < b) b = d;
    });
    tot += (b - a) / Math.max(a, b);
  });
  return tot / data.length;
}

/* ---------- 主成分分析 ---------- */
/* 対称行列の固有値分解（ヤコビ法）。変数が十数個なので速度は問題にならない。 */
function jacobiEigen(Ain, {sweeps = 100, eps = 1e-10} = {}) {
  const n = Ain.length;
  const A = Ain.map(r => r.slice());
  let V = Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => (i === j ? 1 : 0)));
  for (let s = 0; s < sweeps; s++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < eps) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < eps) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), sn = t * c;
        for (let i = 0; i < n; i++) {
          const aip = A[i][p], aiq = A[i][q];
          A[i][p] = c * aip - sn * aiq;
          A[i][q] = sn * aip + c * aiq;
        }
        for (let i = 0; i < n; i++) {
          const api = A[p][i], aqi = A[q][i];
          A[p][i] = c * api - sn * aqi;
          A[q][i] = sn * api + c * aqi;
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i][p], viq = V[i][q];
          V[i][p] = c * vip - sn * viq;
          V[i][q] = sn * vip + c * viq;
        }
      }
    }
  }
  const vals = A.map((r, i) => r[i]);
  const order = vals.map((v, i) => i).sort((a, b) => vals[b] - vals[a]);
  return {
    values: order.map(i => vals[i]),
    vectors: order.map(i => V.map(r => r[i])),   // vectors[k] = 第k主成分の係数ベクトル
  };
}

/* rows: 標準化済みのデータ行列。相関行列の固有分解として主成分を出す。 */
export function pca(rowsZ) {
  const n = rowsZ.length, p = n ? rowsZ[0].length : 0;
  if (n < 3 || p < 2) return null;
  /* 共分散（標準化済みなので相関行列に等しい） */
  const C = Array.from({length: p}, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += rowsZ[r][i] * rowsZ[r][j];
      C[i][j] = C[j][i] = s / (n - 1);
    }
  }
  const {values, vectors} = jacobiEigen(C);
  const total = values.reduce((a, v) => a + Math.max(0, v), 0) || 1;
  /* 負荷量 = 固有ベクトル × √固有値（変数と主成分の相関） */
  const loadings = vectors.map((vec, k) => vec.map(v => v * Math.sqrt(Math.max(0, values[k]))));
  /* 主成分得点 */
  const scores = rowsZ.map(r => vectors.map(vec => r.reduce((s, v, j) => s + v * vec[j], 0)));
  return {
    values,
    ratio: values.map(v => Math.max(0, v) / total),
    cumulative: values.reduce((acc, v) => {
      acc.push((acc[acc.length - 1] || 0) + Math.max(0, v) / total);
      return acc;
    }, []),
    vectors, loadings, scores, n, p,
  };
}

/* 標本数と変数の数から、結果をどこまで信用してよいかの目安を返す */
export function adequacy(n, p) {
  const ratio = p > 0 ? n / p : 0;
  if (n < p + 1) {
    return {level: 'bad', ratio,
      text: `標本${n}件に対して変数${p}個。標本が変数より少ないため、主成分は数学的には出ますが解釈はできません。`};
  }
  if (ratio < 3) {
    return {level: 'bad', ratio,
      text: `標本${n}件 ÷ 変数${p}個 = ${ratio.toFixed(1)}倍。目安の5倍を大きく下回るため、負荷量は標本が増えると大きく変わります。傾向を眺める程度に留めてください。`};
  }
  if (ratio < 5) {
    return {level: 'warn', ratio,
      text: `標本${n}件 ÷ 変数${p}個 = ${ratio.toFixed(1)}倍。目安の5倍にやや届きません。大枠の傾向は読めますが、細かい順位は動きます。`};
  }
  return {level: 'ok', ratio,
    text: `標本${n}件 ÷ 変数${p}個 = ${ratio.toFixed(1)}倍。探索的に読むには十分です。`};
}
