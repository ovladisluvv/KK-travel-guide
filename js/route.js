// Построение оптимального маршрута по набору точек

// Расстояние между двумя точками по формуле гаверсинуса, км
function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Полная длина маршрута (сумма ребер по порядку), км
function routeLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineKm(points[i], points[i + 1]);
  }
  return total;
}

// Жадный ближайший сосед из заданной стартовой точки
function nearestNeighbor(points, startIndex) {
  const n = points.length;
  const visited = new Array(n).fill(false);
  const order = [startIndex];
  visited[startIndex] = true;
  for (let step = 1; step < n; step++) {
    const last = points[order[order.length - 1]];
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const d = haversineKm(last, points[j]);
      if (d < bestDist) { bestDist = d; best = j; }
    }
    order.push(best);
    visited[best] = true;
  }
  return order;
}

// Локальное улучшение 2-opt: разворачиваем участки, пока маршрут укорачивается
function twoOpt(points, order) {
  const dist = (i, j) => haversineKm(points[order[i]], points[order[j]]);
  let improved = true;
  const n = order.length;
  let guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        // текущие ребра (i-1,i) и (k,k+1) против (i-1,k) и (i,k+1)
        const a = i === 0 ? null : dist(i - 1, i);
        const b = k === n - 1 ? null : dist(k, k + 1);
        const c = i === 0 ? null : dist(i - 1, k);
        const d = k === n - 1 ? null : dist(i, k + 1);
        const before = (a ?? 0) + (b ?? 0);
        const after = (c ?? 0) + (d ?? 0);
        if (after + 1e-9 < before) {
          let lo = i, hi = k;
          while (lo < hi) { [order[lo], order[hi]] = [order[hi], order[lo]]; lo++; hi--; }
          improved = true;
        }
      }
    }
  }
  return order;
}

// Открытый маршрут: пробуем каждый старт и берем лучший
function buildOptimalRoute(places) {
  if (!places || places.length === 0) return { ordered: [], distanceKm: 0 };
  if (places.length === 1) return { ordered: [places[0]], distanceKm: 0 };

  const pts = places.map(p => ({ lat: p.lat, lng: p.lng }));
  let bestOrder = null;
  let bestLen = Infinity;

  for (let s = 0; s < pts.length; s++) {
    const order = twoOpt(pts, nearestNeighbor(pts, s));
    const len = routeLength(order.map(i => pts[i]));
    if (len < bestLen) { bestLen = len; bestOrder = order; }
  }

  return {
    ordered: bestOrder.map(i => places[i]),
    distanceKm: bestLen,
  };
}

// Ссылка на Яндекс.Карты с маршрутом (несколько точек через ~)
function yandexRouteUrl(ordered) {
  const pts = ordered.map(p => `${p.lat},${p.lng}`).join('~');
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(pts)}&rtt=auto`;
}
