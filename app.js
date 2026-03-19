// ── Configuration ──────────────────────────────────────────────────────────
const CARDANO_CIRCULATING_SUPPLY = 36e9;
const STAKING_RATIO = 0.60;
const TOTAL_STAKED_ADA = CARDANO_CIRCULATING_SUPPLY * STAKING_RATIO;
const TARGET_TVL_USD = 3e9;

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

// Chains shown in the monthly comparison line chart (high-TVL chains + Cardano)
const COMPARISON_LINE_CHAINS = [
  'Ethereum', 'Solana', 'BSC', 'Tron', 'Avalanche', 'Sui', 'Cardano',
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

// ── Data fetching ──────────────────────────────────────────────────────────

async function getAllChainsTVL() {
  return fetchJSON('https://api.llama.fi/v2/chains');
}

async function getHistoricalTVL(chain) {
  return fetchJSON(`https://api.llama.fi/v2/historicalChainTvl/${chain}`);
}

/** CoinGecko: current prices + market caps for all chains in one call */
async function getCurrentMarketData() {
  const ids = [...new Set(Object.values(CHAINS).map(c => c.geckoId))].join(',');
  const data = await fetchJSON(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true`
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

/**
 * CoinGecko: historical prices + market caps (daily, last 365 days).
 * Returns { prices: {dateStr: price}, mcaps: {dateStr: mcap} }
 */
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
  new Chart($('comparison-chart').getContext('2d'), {
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
  chainData.sort((a, b) => b.pct - a.pct);
  new Chart($('bar-chart').getContext('2d'), {
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
  // Staked ADA chart duration buttons
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

  // All ADA chart duration buttons
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

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  $('last-updated').textContent = new Date().toLocaleString();
  setupDurationSelector();

  let currentTvlUSD = 0, currentTvlADA = 0, adaPrice = 0, currentPct = 0;

  // ── 1. Snapshot + bar chart (single CoinGecko call for all current data)
  let allChains, marketData;
  try {
    [allChains, marketData] = await Promise.all([getAllChainsTVL(), getCurrentMarketData()]);

    const cardanoChain = allChains.find(c => c.name === 'Cardano');
    currentTvlUSD = cardanoChain ? cardanoChain.tvl : 0;
    adaPrice = marketData.Cardano ? marketData.Cardano.price : 0;
    currentTvlADA = adaPrice > 0 ? currentTvlUSD / adaPrice : 0;
    currentPct = (currentTvlADA / TOTAL_STAKED_ADA) * 100;

    // % of all ADA (including unstaked) in DeFi
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

    // Staked ADA dollar value
    const stakedAdaUSD = TOTAL_STAKED_ADA * adaPrice;
    $('staked-ada-usd').textContent = '$' + fmt(stakedAdaUSD);
    $('staked-ada-usd-detail').textContent = fmt(TOTAL_STAKED_ADA) + ' ADA × $' + adaPrice.toFixed(4) + ' per ADA';

    $('ada-price').textContent = '$' + adaPrice.toFixed(4);
    $('target-progress').textContent = 'Current: $' + fmt(currentTvlUSD) + ' (' + ((currentTvlUSD / TARGET_TVL_USD) * 100).toFixed(1) + '% of target)';

    // Bar chart: TVL / Market Cap for all chains
    const barData = [];
    for (const [slug, info] of Object.entries(CHAINS)) {
      const chain = allChains.find(c => c.name === slug);
      const mkt = marketData[slug];
      if (!chain || !mkt || !mkt.mcap || mkt.mcap === 0) continue;
      // Skip Base (shares ETH token, market cap comparison is misleading)
      if (slug === 'Base') continue;
      barData.push({ name: slug, pct: (chain.tvl / mkt.mcap) * 100 });
    }
    renderBarChart(barData);

    // Impact table
    renderImpactTable(currentTvlUSD, currentTvlADA, adaPrice, currentPct);
  } catch (err) {
    console.error('Snapshot error:', err);
    $('cardano-pct').textContent = 'Error';
  }

  // ── 2. Cardano historical chart (weekly) ───────────────────────────────
  try {
    $('cardano-chart-status').textContent = 'Loading historical data...';

    // Fetch TVL history (DefiLlama, no rate limit) and ADA price history (CoinGecko, 365 days)
    const [histTVL, adaHistory] = await Promise.all([
      getHistoricalTVL('Cardano'),
      getHistoricalMarketData('cardano'),
    ]);

    const adaPrices = adaHistory.prices;
    const priceCount = Object.keys(adaPrices).length;

    if (priceCount === 0) {
      $('cardano-chart-status').textContent = 'Could not load ADA price history. Check console for errors.';
      return;
    }

    // Build daily deployed % by matching TVL dates with price dates
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
      'Uses circulating supply (36B ADA) as denominator.';
  } catch (err) {
    console.error('Cardano historical error:', err);
    $('cardano-chart-status').textContent = 'Error: ' + err.message;
  }

  // ── 3. Multi-chain comparison: TVL / Market Cap over time (monthly) ────
  try {
    // Fetch all TVL histories from DefiLlama in parallel (no rate limit)
    const tvlHistories = {};
    await Promise.all(COMPARISON_LINE_CHAINS.map(async chain => {
      tvlHistories[chain] = await getHistoricalTVL(chain);
    }));

    // Fetch historical market caps from CoinGecko one at a time with delays
    const comparisonDatasets = [];

    for (const chain of COMPARISON_LINE_CHAINS) {
      try {
        const info = CHAINS[chain];
        if (!info) continue;

        // Respect CoinGecko free-tier rate limit (~10-30 req/min)
        await new Promise(r => setTimeout(r, 2500));

        const cgData = await getHistoricalMarketData(info.geckoId);
        const histTVL = tvlHistories[chain];
        if (!histTVL) continue;

        // Filter to last 12 months and sample monthly
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

          // TVL / Market Cap — same metric for all chains
          const pct = (point.tvl / mcap) * 100;
          if (pct > 0 && pct < 200) { // sanity
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
  } catch (err) {
    console.error('Comparison error:', err);
  }
}

main();
