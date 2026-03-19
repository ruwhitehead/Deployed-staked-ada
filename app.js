// ── Configuration ──────────────────────────────────────────────────────────
let CARDANO_CIRCULATING_SUPPLY = 36e9;   // updated live from Koios if available
let STAKING_RATIO = 0.60;                // updated live from Koios if available
let TOTAL_STAKED_ADA = CARDANO_CIRCULATING_SUPPLY * STAKING_RATIO;
const TARGET_TVL_USD = 3e9;
const CACHE_KEY = 'ada-dashboard-cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Chains for comparison — top chains by TVL plus Cardano
const CHAINS = {
  'Ethereum':  { geckoId: 'ethereum',     color: '#627eea' },
  'Solana':    { geckoId: 'solana',        color: '#9945ff' },
  'BSC':       { geckoId: 'binancecoin',   color: '#f0b90b' },
  'Tron':      { geckoId: 'tron',          color: '#ff6b6b' },
  'Arbitrum':  { geckoId: 'arbitrum',      color: '#28a0f0' },
  'Base':      { geckoId: 'ethereum',      color: '#0052ff' },
  'Polygon':   { geckoId: 'matic-network', color: '#8247e5' },
  'Avalanche': { geckoId: 'avalanche-2',   color: '#e84142' },
  'Optimism':  { geckoId: 'optimism',      color: '#ff0420' },
  'Sui':       { geckoId: 'sui',           color: '#6fbcf0' },
  'Aptos':     { geckoId: 'aptos',         color: '#4cd7b0' },
  'Mantle':    { geckoId: 'mantle',        color: '#c4a6ff' },
  'Cardano':   { geckoId: 'cardano',       color: '#3cc8c8' },
  'Thorchain': { geckoId: 'thorchain',     color: '#33ff99' },
};

// Chains shown in the monthly comparison line chart
const COMPARISON_LINE_CHAINS = [
  'Ethereum', 'Solana', 'BSC', 'Tron', 'Avalanche', 'Sui', 'Cardano',
];

// Protocol pie chart colors
const PROTOCOL_COLORS = [
  '#3cc8c8', '#627eea', '#9945ff', '#f0b90b', '#ff6b6b', '#28a0f0',
  '#8247e5', '#e84142', '#ff0420', '#6fbcf0', '#4cd7b0', '#c4a6ff',
  '#33ff99', '#f59e0b', '#22c55e', '#ef4444', '#a78bfa', '#60a5fa',
];

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (n, decimals = 2) => {
  if (n >= 1e12) return (n / 1e12).toFixed(decimals) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// ── Cache ──────────────────────────────────────────────────────────────────
function saveCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) { /* quota exceeded, ignore */ }
}

function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

async function fetchWithCache(url, cacheKey) {
  const cached = loadCache(cacheKey);
  if (cached) return cached;
  const data = await fetchJSON(url);
  saveCache(cacheKey, data);
  return data;
}

// ── Data fetching ──────────────────────────────────────────────────────────

/** Koios: get live staking data from Cardano blockchain */
async function getKoiosStakingData() {
  try {
    const data = await fetchJSON('https://api.koios.rest/api/v1/totals?limit=1');
    if (data && data.length > 0) {
      const epoch = data[0];
      // Koios returns values in lovelace (1 ADA = 1,000,000 lovelace)
      const circulation = parseFloat(epoch.circulation) / 1e6;
      const stake = parseFloat(epoch.stake) / 1e6;
      return { circulation, stake, ratio: stake / circulation, epoch: epoch.epoch_no, source: 'live' };
    }
  } catch (err) {
    console.warn('Koios API unavailable, using fallback:', err.message);
  }
  return null;
}

async function getAllChainsTVL() {
  return fetchWithCache('https://api.llama.fi/v2/chains', 'cache-chains');
}

async function getHistoricalTVL(chain) {
  return fetchWithCache(`https://api.llama.fi/v2/historicalChainTvl/${chain}`, `cache-hist-${chain}`);
}

async function getCardanoProtocols() {
  const allProtocols = await fetchWithCache('https://api.llama.fi/protocols', 'cache-protocols');
  return allProtocols
    .filter(p => p.chains && p.chains.includes('Cardano') && p.tvl > 0)
    .map(p => ({
      name: p.name,
      tvl: p.chainTvls && p.chainTvls.Cardano ? p.chainTvls.Cardano : p.tvl,
      category: p.category || 'Other',
      logo: p.logo,
    }))
    .sort((a, b) => b.tvl - a.tvl);
}

/** CoinGecko: current prices + market caps for all chains in one call */
async function getCurrentMarketData() {
  const ids = [...new Set(Object.values(CHAINS).map(c => c.geckoId))].join(',');
  const data = await fetchWithCache(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true`,
    'cache-market'
  );
  const result = {};
  for (const [chain, info] of Object.entries(CHAINS)) {
    if (data[info.geckoId]) {
      result[chain] = {
        price: data[info.geckoId].usd,
        mcap: data[info.geckoId].usd_market_cap,
      };
    }
  }
  return result;
}

/** CoinGecko: historical prices + market caps (daily, last 365 days). */
async function getHistoricalMarketData(geckoId) {
  const data = await fetchJSON(
    `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=365&interval=daily`
  );
  const prices = {};
  const mcaps = {};
  for (const [ts, price] of data.prices) {
    prices[new Date(ts).toISOString().slice(0, 10)] = price;
  }
  for (const [ts, cap] of data.market_caps) {
    mcaps[new Date(ts).toISOString().slice(0, 10)] = cap;
  }
  return { prices, mcaps };
}

// ── Chart state ────────────────────────────────────────────────────────────
let cardanoChartInstance = null;
let allAdaChartInstance = null;
let protocolChartInstance = null;
let targetChartInstance = null;
let barChartInstance = null;
let comparisonChartInstance = null;
let cardanoAllDailyData = [];
let allAdaAllDailyData = [];

function filterByDuration(data, weeks) {
  if (weeks === 0) return data;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return data.filter(d => d.date >= cutoffStr);
}

function sampleToWeekly(dailyData) {
  if (dailyData.length === 0) return [];
  const result = [dailyData[0]];
  let last = new Date(dailyData[0].date);
  for (let i = 1; i < dailyData.length; i++) {
    const cur = new Date(dailyData[i].date);
    if ((cur - last) / 86400000 >= 6) {
      result.push(dailyData[i]);
      last = cur;
    }
  }
  return result;
}

// ── Chart rendering ────────────────────────────────────────────────────────

function renderCardanoChart(weeklyData) {
  if (cardanoChartInstance) cardanoChartInstance.destroy();

  const canvas = $('cardano-chart');
  if (weeklyData.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data available for selected range', canvas.width / 2, canvas.height / 2);
    return;
  }

  cardanoChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: weeklyData.map(d => d.date),
      datasets: [{
        label: '% Staked ADA Deployed',
        data: weeklyData.map(d => d.pct),
        borderColor: '#3cc8c8',
        backgroundColor: 'rgba(60, 200, 200, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: weeklyData.length < 30 ? 4 : 0,
        pointHitRadius: 10,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: weeklyData.length < 20 ? 'week' : 'month',
            tooltipFormat: 'dd MMM yyyy',
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af' },
        },
        y: {
          title: { display: true, text: '% Deployed', color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', callback: v => v.toFixed(2) + '%' },
        }
      },
      plugins: {
        legend: { labels: { color: '#e4e4e7' } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.parsed.y.toFixed(3) + '%' } },
      }
    }
  });
}

function renderAllAdaChart(weeklyData) {
  if (allAdaChartInstance) allAdaChartInstance.destroy();

  const canvas = $('all-ada-chart');
  if (weeklyData.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data available for selected range', canvas.width / 2, canvas.height / 2);
    return;
  }

  allAdaChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: weeklyData.map(d => d.date),
      datasets: [{
        label: '% of All ADA in DeFi',
        data: weeklyData.map(d => d.pct),
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167, 139, 250, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: weeklyData.length < 30 ? 4 : 0,
        pointHitRadius: 10,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: weeklyData.length < 20 ? 'week' : 'month',
            tooltipFormat: 'dd MMM yyyy',
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af' },
        },
        y: {
          title: { display: true, text: '% of All ADA in DeFi', color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', callback: v => v.toFixed(2) + '%' },
        }
      },
      plugins: {
        legend: { labels: { color: '#e4e4e7' } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.parsed.y.toFixed(3) + '%' } },
      }
    }
  });
}

// Plugin: draw chain name at end of each line
const endLabelPlugin = {
  id: 'endLabels',
  afterDraw(chart) {
    const { ctx, chartArea } = chart;
    chart.data.datasets.forEach((ds, idx) => {
      const meta = chart.getDatasetMeta(idx);
      if (!meta.visible) return;
      const last = meta.data[meta.data.length - 1];
      if (!last) return;
      ctx.save();
      ctx.fillStyle = ds.borderColor;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ds.label, Math.min(last.x + 6, chartArea.right + 4), last.y);
      ctx.restore();
    });
  }
};

function renderComparisonChart(datasets) {
  if (comparisonChartInstance) comparisonChartInstance.destroy();
  comparisonChartInstance = new Chart($('comparison-chart').getContext('2d'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      layout: { padding: { right: 80 } },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', tooltipFormat: 'MMM yyyy' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af' },
        },
        y: {
          title: { display: true, text: 'Deployment % (TVL / Market Cap)', color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', callback: v => v.toFixed(0) + '%' },
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e4e4e7', usePointStyle: true, pointStyle: 'line', padding: 15 },
          position: 'bottom',
        },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.parsed.y.toFixed(2) + '%' } },
      }
    },
    plugins: [endLabelPlugin],
  });
}

function renderBarChart(chainData) {
  if (barChartInstance) barChartInstance.destroy();
  chainData.sort((a, b) => b.pct - a.pct);
  barChartInstance = new Chart($('bar-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: chainData.map(d => d.name),
      datasets: [{
        label: 'Deployment %',
        data: chainData.map(d => d.pct),
        backgroundColor: chainData.map(d =>
          d.name === 'Cardano' ? '#3cc8c8' : 'rgba(99, 102, 241, 0.6)'
        ),
        borderColor: chainData.map(d =>
          d.name === 'Cardano' ? '#3cc8c8' : 'rgba(99, 102, 241, 0.8)'
        ),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          title: { display: true, text: 'TVL / Market Cap %', color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', callback: v => v + '%' },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#e4e4e7', font: { size: 11 } },
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.x.toFixed(2) + '%' } },
      }
    }
  });
}

function renderProtocolChart(protocols) {
  if (protocolChartInstance) protocolChartInstance.destroy();

  const top = protocols.slice(0, 15);
  const otherTvl = protocols.slice(15).reduce((sum, p) => sum + p.tvl, 0);
  if (otherTvl > 0) top.push({ name: 'Other', tvl: otherTvl, category: 'Other' });

  const totalTvl = top.reduce((sum, p) => sum + p.tvl, 0);

  protocolChartInstance = new Chart($('protocol-chart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: top.map(p => p.name),
      datasets: [{
        data: top.map(p => p.tvl),
        backgroundColor: top.map((_, i) => PROTOCOL_COLORS[i % PROTOCOL_COLORS.length]),
        borderColor: '#1a1d27',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => {
              const val = c.parsed;
              const pct = ((val / totalTvl) * 100).toFixed(1);
              return c.label + ': $' + fmt(val) + ' (' + pct + '%)';
            }
          }
        },
      }
    }
  });

  // Protocol table
  const tbody = $('protocol-tbody');
  tbody.innerHTML = '';
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const pct = ((p.tvl / totalTvl) * 100).toFixed(1);
    const color = PROTOCOL_COLORS[i % PROTOCOL_COLORS.length];
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="protocol-color" style="background:${color}"></span>${p.name}</td>
      <td>$${fmt(p.tvl)}</td>
      <td>${pct}%</td>
    `;
    tbody.appendChild(row);
  }
}

function renderTargetChart(histTVL, currentTvlUSD) {
  if (targetChartInstance) targetChartInstance.destroy();

  // Historical TVL data (last 2 years)
  const twoYearsAgo = Date.now() / 1000 - 730 * 86400;
  const recentHist = histTVL
    .filter(p => p.date >= twoYearsAgo)
    .filter((_, i, arr) => i % 7 === 0 || i === arr.length - 1) // weekly
    .map(p => ({ x: new Date(p.date * 1000).toISOString().slice(0, 10), y: p.tvl }));

  // Target trajectory: from today to Dec 31, 2030
  const today = new Date();
  const target2030 = new Date('2030-12-31');
  const monthsToTarget = (target2030 - today) / (30.44 * 86400000);
  const trajectoryPoints = [];

  for (let m = 0; m <= monthsToTarget; m += 1) {
    const date = new Date(today);
    date.setMonth(date.getMonth() + m);
    const progress = m / monthsToTarget;
    // Exponential growth curve from current TVL to $3B
    const tvl = currentTvlUSD * Math.pow(TARGET_TVL_USD / currentTvlUSD, progress);
    trajectoryPoints.push({
      x: date.toISOString().slice(0, 10),
      y: tvl,
    });
  }

  targetChartInstance = new Chart($('target-chart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Actual TVL (USD)',
          data: recentHist,
          borderColor: '#3cc8c8',
          backgroundColor: 'rgba(60, 200, 200, 0.05)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
        },
        {
          label: 'Required Trajectory to $3B',
          data: trajectoryPoints,
          borderColor: '#60a5fa',
          borderDash: [8, 4],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'quarter', tooltipFormat: 'MMM yyyy' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af' },
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'TVL (USD) — Log Scale', color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#9ca3af',
            callback: v => {
              if (v >= 1e9) return '$' + (v / 1e9).toFixed(0) + 'B';
              if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
              return '$' + fmt(v);
            }
          },
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e4e4e7', usePointStyle: true, pointStyle: 'line', padding: 15 },
          position: 'bottom',
        },
        tooltip: { callbacks: { label: c => c.dataset.label + ': $' + fmt(c.parsed.y) } },
        annotation: {
          annotations: {
            targetLine: {
              type: 'line',
              yMin: TARGET_TVL_USD,
              yMax: TARGET_TVL_USD,
              borderColor: '#f59e0b',
              borderWidth: 2,
              borderDash: [4, 4],
              label: {
                display: true,
                content: '$3B Target',
                position: 'start',
                backgroundColor: 'rgba(245, 158, 11, 0.8)',
                color: '#fff',
                font: { size: 11 },
              }
            }
          }
        }
      }
    }
  });
}

// ── Impact Table ───────────────────────────────────────────────────────────
function renderImpactTable(currentTvlUSD, currentTvlADA, adaPrice, currentPct) {
  const uplifts = [1, 2, 3, 4, 5, 10, 15, 20];
  const tbody = $('impact-tbody');
  tbody.innerHTML = '';

  for (const target of uplifts) {
    const newTvlADA = TOTAL_STAKED_ADA * (target / 100);
    const additionalADA = newTvlADA - currentTvlADA;
    const newTvlUSD = newTvlADA * adaPrice;
    const additionalUSD = newTvlUSD - currentTvlUSD;
    const multiplier = currentTvlUSD > 0 ? newTvlUSD / currentTvlUSD : 0;

    const row = document.createElement('tr');
    if (currentPct >= target) row.className = 'achieved';
    row.innerHTML = `
      <td>${target}%</td>
      <td>${fmt(newTvlADA)} ADA</td>
      <td>$${fmt(newTvlUSD)}</td>
      <td>${additionalADA > 0 ? '+' : ''}${fmt(additionalADA)} ADA</td>
      <td>${additionalUSD > 0 ? '+$' : '-$'}${fmt(Math.abs(additionalUSD))}</td>
      <td>${multiplier.toFixed(1)}x</td>
    `;
    tbody.appendChild(row);
  }
}

// ── Duration selector ──────────────────────────────────────────────────────
function setupDurationSelector() {
  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const weeks = parseInt(btn.dataset.weeks);
      const filtered = filterByDuration(cardanoAllDailyData, weeks);
      const weekly = sampleToWeekly(filtered);
      renderCardanoChart(weekly);
    });
  });

  document.querySelectorAll('.duration-btn-b').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.duration-btn-b').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const weeks = parseInt(btn.dataset.weeks);
      const filtered = filterByDuration(allAdaAllDailyData, weeks);
      const weekly = sampleToWeekly(filtered);
      renderAllAdaChart(weekly);
    });
  });
}

// ── Export PNG ──────────────────────────────────────────────────────────────
function setupExport() {
  $('export-btn').addEventListener('click', async () => {
    const btn = $('export-btn');
    btn.disabled = true;
    btn.textContent = 'Exporting...';
    try {
      // Use html2canvas if available, otherwise canvas-only export
      const canvases = document.querySelectorAll('canvas');
      if (canvases.length === 0) return;

      // Simple approach: export all charts as a combined image
      const mainEl = $('dashboard-main');
      // Fallback: export the first chart as a sample
      const link = document.createElement('a');
      const allCanvases = Array.from(canvases);

      // Create a combined canvas
      const padding = 20;
      const totalHeight = allCanvases.reduce((h, c) => h + c.height + padding, padding);
      const maxWidth = Math.max(...allCanvases.map(c => c.width)) + padding * 2;

      const combined = document.createElement('canvas');
      combined.width = maxWidth;
      combined.height = totalHeight;
      const ctx = combined.getContext('2d');
      ctx.fillStyle = '#0f1117';
      ctx.fillRect(0, 0, combined.width, combined.height);

      // Title
      ctx.fillStyle = '#e4e4e7';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('Deployed Staked ADA Dashboard — ' + new Date().toLocaleDateString(), padding, 30);

      let y = 50;
      for (const c of allCanvases) {
        ctx.drawImage(c, padding, y);
        y += c.height + padding;
      }

      link.download = 'ada-dashboard-' + new Date().toISOString().slice(0, 10) + '.png';
      link.href = combined.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export PNG';
    }
  });
}

// ── Refresh ────────────────────────────────────────────────────────────────
function setupRefresh() {
  $('refresh-btn').addEventListener('click', () => {
    // Clear caches
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('cache-') || k === CACHE_KEY) localStorage.removeItem(k);
      });
    } catch {}
    $('refresh-btn').textContent = 'Refreshing...';
    $('refresh-btn').disabled = true;
    main().then(() => {
      $('refresh-btn').textContent = 'Refresh Data';
      $('refresh-btn').disabled = false;
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  $('last-updated').textContent = new Date().toLocaleString();
  $('data-status').textContent = 'Loading...';
  setupDurationSelector();

  let currentTvlUSD = 0, currentTvlADA = 0, adaPrice = 0, currentPct = 0;
  let histTVLCardano = null;

  // ── 0. Get live staking data from Koios ─────────────────────────────────
  const koiosData = await getKoiosStakingData();
  if (koiosData) {
    CARDANO_CIRCULATING_SUPPLY = koiosData.circulation;
    STAKING_RATIO = koiosData.ratio;
    TOTAL_STAKED_ADA = koiosData.stake;
    $('staking-source').textContent =
      'Live staking data from Koios (Epoch ' + koiosData.epoch + '): ' +
      (STAKING_RATIO * 100).toFixed(1) + '% staking ratio.';
    $('staking-ratio-detail').textContent =
      'Ratio: ' + (STAKING_RATIO * 100).toFixed(1) + '% (Epoch ' + koiosData.epoch + ')';
  } else {
    $('staking-source').textContent = 'Staking ratio assumed at 60% (Koios unavailable).';
    $('staking-ratio-detail').textContent = 'Ratio: ~60% (estimated)';
  }

  // ── 1. Snapshot + bar chart ─────────────────────────────────────────────
  let allChains, marketData;
  try {
    [allChains, marketData] = await Promise.all([getAllChainsTVL(), getCurrentMarketData()]);

    const cardanoChain = allChains.find(c => c.name === 'Cardano');
    currentTvlUSD = cardanoChain ? cardanoChain.tvl : 0;
    adaPrice = marketData.Cardano ? marketData.Cardano.price : 0;
    currentTvlADA = adaPrice > 0 ? currentTvlUSD / adaPrice : 0;
    currentPct = (currentTvlADA / TOTAL_STAKED_ADA) * 100;

    const allAdaPct = (currentTvlADA / CARDANO_CIRCULATING_SUPPLY) * 100;

    $('cardano-pct').textContent = currentPct.toFixed(2) + '%';
    $('cardano-detail').textContent = fmt(currentTvlADA) + ' ADA deployed out of ' + fmt(TOTAL_STAKED_ADA) + ' staked ADA';
    $('cardano-usd-equiv').textContent = 'TVL: $' + fmt(currentTvlUSD) + ' deployed out of $' + fmt(TOTAL_STAKED_ADA * adaPrice) + ' staked';
    $('all-ada-pct').textContent = allAdaPct.toFixed(2) + '%';
    $('all-ada-detail').textContent = fmt(currentTvlADA) + ' ADA deployed out of ' + fmt(CARDANO_CIRCULATING_SUPPLY) + ' circulating ADA';
    $('all-ada-usd-equiv').textContent = 'TVL: $' + fmt(currentTvlUSD) + ' deployed out of $' + fmt(CARDANO_CIRCULATING_SUPPLY * adaPrice) + ' market cap';
    $('tvl-usd').textContent = '$' + fmt(currentTvlUSD);
    $('tvl-ada').textContent = fmt(currentTvlADA) + ' ADA';
    $('staked-ada').textContent = fmt(TOTAL_STAKED_ADA) + ' ADA';

    const stakedAdaUSD = TOTAL_STAKED_ADA * adaPrice;
    $('staked-ada-usd').textContent = '$' + fmt(stakedAdaUSD);
    $('staked-ada-usd-detail').textContent = fmt(TOTAL_STAKED_ADA) + ' ADA x $' + adaPrice.toFixed(4) + ' per ADA';

    $('ada-price').textContent = '$' + adaPrice.toFixed(4);
    $('target-progress').textContent = 'Current: $' + fmt(currentTvlUSD) + ' (' + ((currentTvlUSD / TARGET_TVL_USD) * 100).toFixed(1) + '% of target)';

    // Bar chart
    const barData = [];
    for (const [slug, info] of Object.entries(CHAINS)) {
      const chain = allChains.find(c => c.name === slug);
      const mkt = marketData[slug];
      if (!chain || !mkt || !mkt.mcap || mkt.mcap === 0) continue;
      if (slug === 'Base') continue;
      barData.push({ name: slug, pct: (chain.tvl / mkt.mcap) * 100 });
    }
    renderBarChart(barData);

    renderImpactTable(currentTvlUSD, currentTvlADA, adaPrice, currentPct);

    $('data-status').textContent = 'Snapshot loaded';
  } catch (err) {
    console.error('Snapshot error:', err);
    $('cardano-pct').textContent = 'Error';
    $('data-status').textContent = 'Error loading snapshot';
  }

  // ── 1b. Protocol breakdown ─────────────────────────────────────────────
  try {
    const protocols = await getCardanoProtocols();
    if (protocols.length > 0) {
      renderProtocolChart(protocols);
    }
  } catch (err) {
    console.error('Protocol error:', err);
  }

  // ── 2. Cardano historical chart (weekly) ───────────────────────────────
  try {
    $('cardano-chart-status').textContent = 'Loading historical data...';

    const [histTVL, adaHistory] = await Promise.all([
      getHistoricalTVL('Cardano'),
      getHistoricalMarketData('cardano'),
    ]);

    histTVLCardano = histTVL;

    const adaPrices = adaHistory.prices;
    const priceCount = Object.keys(adaPrices).length;

    if (priceCount === 0) {
      $('cardano-chart-status').textContent = 'Could not load ADA price history. Check console for errors.';
    } else {
      cardanoAllDailyData = [];
      allAdaAllDailyData = [];
      let matched = 0;
      for (const point of histTVL) {
        const dateStr = new Date(point.date * 1000).toISOString().slice(0, 10);
        const price = adaPrices[dateStr];
        if (!price || price === 0) continue;
        const tvlADA = point.tvl / price;
        const stakedPct = (tvlADA / TOTAL_STAKED_ADA) * 100;
        const allPct = (tvlADA / CARDANO_CIRCULATING_SUPPLY) * 100;
        if (stakedPct > 0 && stakedPct < 100) {
          cardanoAllDailyData.push({ date: dateStr, pct: stakedPct });
          allAdaAllDailyData.push({ date: dateStr, pct: allPct });
          matched++;
        }
      }

      const weekly = sampleToWeekly(cardanoAllDailyData);
      renderCardanoChart(weekly);

      const weeklyAllAda = sampleToWeekly(allAdaAllDailyData);
      renderAllAdaChart(weeklyAllAda);

      const from = cardanoAllDailyData.length > 0 ? cardanoAllDailyData[0].date : 'N/A';
      const to = cardanoAllDailyData.length > 0 ? cardanoAllDailyData[cardanoAllDailyData.length - 1].date : 'N/A';
      $('cardano-chart-status').textContent =
        matched + ' daily data points (' + from + ' to ' + to + '), showing ' + weekly.length + ' weekly samples. ' +
        'Price data covers last ~365 days (CoinGecko free tier limit).';
      $('all-ada-chart-status').textContent =
        matched + ' daily data points (' + from + ' to ' + to + '), showing ' + weeklyAllAda.length + ' weekly samples. ' +
        'Uses circulating supply (' + fmt(CARDANO_CIRCULATING_SUPPLY) + ' ADA) as denominator.';
    }

    // Render target chart
    if (histTVL && currentTvlUSD > 0) {
      renderTargetChart(histTVL, currentTvlUSD);
    }
  } catch (err) {
    console.error('Cardano historical error:', err);
    $('cardano-chart-status').textContent = 'Error: ' + err.message;
  }

  // ── 3. Multi-chain comparison ─────────────────────────────────────────
  try {
    const tvlHistories = {};
    await Promise.all(COMPARISON_LINE_CHAINS.map(async chain => {
      tvlHistories[chain] = await getHistoricalTVL(chain);
    }));

    const comparisonDatasets = [];

    for (const chain of COMPARISON_LINE_CHAINS) {
      try {
        const info = CHAINS[chain];
        if (!info) continue;

        await new Promise(r => setTimeout(r, 2500));

        const cgData = await getHistoricalMarketData(info.geckoId);
        const histTVL = tvlHistories[chain];
        if (!histTVL) continue;

        const oneYearAgo = Date.now() / 1000 - 365 * 86400;
        const recent = histTVL.filter(p => p.date >= oneYearAgo);

        const monthlyPoints = [];
        const seenMonths = new Set();

        for (const point of recent) {
          const dateStr = new Date(point.date * 1000).toISOString().slice(0, 10);
          const monthKey = dateStr.slice(0, 7);
          if (seenMonths.has(monthKey)) continue;
          seenMonths.add(monthKey);

          const mcap = cgData.mcaps[dateStr];
          if (!mcap || mcap === 0) continue;

          const pct = (point.tvl / mcap) * 100;
          if (pct > 0 && pct < 200) {
            monthlyPoints.push({ x: dateStr, y: pct });
          }
        }

        if (monthlyPoints.length > 0) {
          comparisonDatasets.push({
            label: chain,
            data: monthlyPoints,
            borderColor: info.color,
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 3,
            pointHitRadius: 10,
            borderWidth: chain === 'Cardano' ? 3 : 2,
          });
        }
      } catch (chainErr) {
        console.warn('Skipping ' + chain + ':', chainErr.message);
      }
    }

    if (comparisonDatasets.length > 0) {
      renderComparisonChart(comparisonDatasets);
    }

    $('data-status').textContent = 'All data loaded at ' + new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Comparison error:', err);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
setupRefresh();
setupExport();
main();
