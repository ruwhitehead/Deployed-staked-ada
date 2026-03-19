// ── Configuration ──────────────────────────────────────────────────────────
const CARDANO_CIRCULATING_SUPPLY = 36e9;
const STAKING_RATIO = 0.60;
const TOTAL_STAKED_ADA = CARDANO_CIRCULATING_SUPPLY * STAKING_RATIO;
const TARGET_TVL_USD = 3e9;

// Chains for comparison (DefiLlama slug → CoinGecko ID)
// Focus on top chains by TVL + Cardano
const CHAINS = {
  'Ethereum':  { geckoId: 'ethereum',     color: '#627eea' },
  'Solana':    { geckoId: 'solana',        color: '#9945ff' },
  'BSC':       { geckoId: 'binancecoin',   color: '#f0b90b' },
  'Tron':      { geckoId: 'tron',          color: '#ff060a' },
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

// Chains to show in the monthly comparison line chart
const COMPARISON_LINE_CHAINS = ['Ethereum', 'Solana', 'BSC', 'Tron', 'Cardano', 'Avalanche', 'Sui'];

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
  if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
  return res.json();
}

// ── Data fetching ──────────────────────────────────────────────────────────

async function getAllChainsTVL() {
  return fetchJSON('https://api.llama.fi/v2/chains');
}

async function getHistoricalTVL(chain) {
  return fetchJSON(`https://api.llama.fi/v2/historicalChainTvl/${chain}`);
}

async function getMarketCaps() {
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

// Use DefiLlama coins API for historical prices (avoids CoinGecko rate limits)
async function getHistoricalPrices(geckoId, days) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - days * 86400;
  const span = days <= 90 ? 4 : 24; // 4-hour or daily granularity
  try {
    const data = await fetchJSON(
      `https://coins.llama.fi/chart/coingecko:${geckoId}?start=${start}&span=${span}&period=1d`
    );
    const map = {};
    if (data && data.coins) {
      const key = `coingecko:${geckoId}`;
      if (data.coins[key] && data.coins[key].prices) {
        for (const p of data.coins[key].prices) {
          const dateStr = new Date(p.timestamp * 1000).toISOString().slice(0, 10);
          map[dateStr] = p.price;
        }
      }
    }
    return map;
  } catch {
    return {};
  }
}

// Fallback: CoinGecko historical prices (limited days to avoid rate limits)
async function getHistoricalPricesCG(geckoId, days) {
  try {
    const data = await fetchJSON(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}&interval=daily`
    );
    const map = {};
    for (const [ts, price] of data.prices) {
      map[new Date(ts).toISOString().slice(0, 10)] = price;
    }
    const mcapMap = {};
    for (const [ts, cap] of data.market_caps) {
      mcapMap[new Date(ts).toISOString().slice(0, 10)] = cap;
    }
    return { prices: map, mcaps: mcapMap };
  } catch {
    return { prices: {}, mcaps: {} };
  }
}

// ── Chart instances (for re-rendering on duration change) ──────────────────
let cardanoChartInstance = null;
let cardanoAllDailyData = []; // stored globally for duration filtering

function filterByDuration(data, durationWeeks) {
  if (durationWeeks === 0) return data; // "All Time"
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - durationWeeks * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return data.filter(d => d.date >= cutoffStr);
}

function sampleToWeekly(dailyData) {
  if (dailyData.length === 0) return [];
  const result = [];
  let lastDate = null;
  for (const d of dailyData) {
    if (!lastDate) {
      result.push(d);
      lastDate = new Date(d.date);
    } else {
      const current = new Date(d.date);
      const diffDays = (current - lastDate) / 86400000;
      if (diffDays >= 6) {
        result.push(d);
        lastDate = current;
      }
    }
  }
  return result;
}

// ── Chart rendering ────────────────────────────────────────────────────────

function renderCardanoChart(weeklyData) {
  if (cardanoChartInstance) {
    cardanoChartInstance.destroy();
  }

  if (weeklyData.length === 0) {
    const ctx = $('cardano-chart').getContext('2d');
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data available for selected range', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const ctx = $('cardano-chart').getContext('2d');
  cardanoChartInstance = new Chart(ctx, {
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
          ticks: {
            color: '#9ca3af',
            callback: v => v.toFixed(2) + '%',
          },
        }
      },
      plugins: {
        legend: { labels: { color: '#e4e4e7' } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}%`,
          }
        }
      }
    }
  });
}

// Custom plugin to draw chain name labels on the right side of the chart
const endLabelPlugin = {
  id: 'endLabels',
  afterDraw(chart) {
    const { ctx, chartArea } = chart;
    chart.data.datasets.forEach((dataset) => {
      const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(dataset));
      if (!meta.visible) return;
      const lastPoint = meta.data[meta.data.length - 1];
      if (!lastPoint) return;
      ctx.save();
      ctx.fillStyle = dataset.borderColor;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const x = Math.min(lastPoint.x + 8, chartArea.right + 5);
      ctx.fillText(dataset.label, x, lastPoint.y);
      ctx.restore();
    });
  }
};

function renderComparisonChart(datasets) {
  const ctx = $('comparison-chart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      layout: {
        padding: { right: 80 } // space for end labels
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', tooltipFormat: 'MMM yyyy' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af' },
        },
        y: {
          title: { display: true, text: 'TVL / Market Cap %', color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#9ca3af',
            callback: v => v.toFixed(0) + '%',
          },
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#e4e4e7',
            usePointStyle: true,
            pointStyle: 'line',
            padding: 15,
          },
          position: 'bottom',
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`,
          }
        }
      }
    },
    plugins: [endLabelPlugin],
  });
}

function renderBarChart(chainData) {
  chainData.sort((a, b) => b.pct - a.pct);
  const ctx = $('bar-chart').getContext('2d');
  new Chart(ctx, {
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
          ticks: {
            color: '#9ca3af',
            callback: v => v + '%',
          },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#e4e4e7', font: { size: 11 } },
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.x.toFixed(2)}%`,
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
    const multiplier = newTvlUSD / currentTvlUSD;

    const row = document.createElement('tr');
    if (target <= currentPct) {
      row.className = 'achieved';
    }
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
  const buttons = document.querySelectorAll('.duration-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const weeks = parseInt(btn.dataset.weeks);
      const filtered = filterByDuration(cardanoAllDailyData, weeks);
      const weekly = sampleToWeekly(filtered);
      renderCardanoChart(weekly);
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  $('last-updated').textContent = new Date().toLocaleString();
  setupDurationSelector();

  let currentTvlUSD = 0;
  let currentTvlADA = 0;
  let adaPrice = 0;
  let currentPct = 0;

  // ── 1. Current Cardano snapshot ────────────────────────────────────────
  try {
    const [allChains, marketData] = await Promise.all([
      getAllChainsTVL(),
      getMarketCaps(),
    ]);

    const cardanoChain = allChains.find(c => c.name === 'Cardano');
    currentTvlUSD = cardanoChain ? cardanoChain.tvl : 0;
    adaPrice = marketData['Cardano'] ? marketData['Cardano'].price : 0;
    currentTvlADA = adaPrice > 0 ? currentTvlUSD / adaPrice : 0;

    // Cardano-specific: TVL in ADA / Total Staked ADA
    currentPct = (currentTvlADA / TOTAL_STAKED_ADA) * 100;

    $('cardano-pct').textContent = currentPct.toFixed(2) + '%';
    $('cardano-detail').textContent =
      `${fmt(currentTvlADA)} ADA deployed out of ${fmt(TOTAL_STAKED_ADA)} staked ADA`;
    $('tvl-usd').textContent = '$' + fmt(currentTvlUSD);
    $('tvl-ada').textContent = fmt(currentTvlADA) + ' ADA';
    $('staked-ada').textContent = fmt(TOTAL_STAKED_ADA) + ' ADA';
    $('ada-price').textContent = '$' + adaPrice.toFixed(4);
    $('target-progress').textContent =
      `Current: $${fmt(currentTvlUSD)} (${((currentTvlUSD / TARGET_TVL_USD) * 100).toFixed(1)}% of target)`;

    // ── Bar chart: TVL / Market Cap for all chains ─────────────────────
    const barData = [];
    for (const [slug, info] of Object.entries(CHAINS)) {
      const chain = allChains.find(c => c.name === slug);
      const mkt = marketData[slug];
      if (!chain || !mkt) continue;

      if (slug === 'Cardano') {
        // Use staked-ADA denominator for Cardano
        barData.push({
          name: 'Cardano (TVL/Staked)',
          pct: currentPct,
        });
      } else if (mkt.mcap && mkt.mcap > 0) {
        // TVL / Market Cap for others
        barData.push({
          name: slug,
          pct: (chain.tvl / mkt.mcap) * 100,
        });
      }
    }
    renderBarChart(barData);

    // ── Impact table ───────────────────────────────────────────────────
    renderImpactTable(currentTvlUSD, currentTvlADA, adaPrice, currentPct);

  } catch (err) {
    console.error('Snapshot error:', err);
    $('cardano-pct').textContent = 'Error loading data';
  }

  // ── 2. Cardano historical chart (weekly) ───────────────────────────────
  try {
    // Fetch Cardano TVL history from DefiLlama
    const histTVL = await getHistoricalTVL('Cardano');

    // Fetch ADA price history from DefiLlama coins API (avoids CoinGecko rate limits)
    let priceMap = await getHistoricalPrices('cardano', 2000);

    // Fallback to CoinGecko if DefiLlama coins API returned nothing
    if (Object.keys(priceMap).length === 0) {
      const cg = await getHistoricalPricesCG('cardano', 365);
      priceMap = cg.prices;
    }

    // If we still have no price data, try to use a single-price approximation
    if (Object.keys(priceMap).length === 0 && adaPrice > 0) {
      // Last resort: use current price for all historical points
      // This is inaccurate but at least shows the TVL trend
      for (const point of histTVL) {
        const dateStr = new Date(point.date * 1000).toISOString().slice(0, 10);
        priceMap[dateStr] = adaPrice;
      }
    }

    // Build daily deployed % data
    cardanoAllDailyData = [];
    for (const point of histTVL) {
      const dateStr = new Date(point.date * 1000).toISOString().slice(0, 10);
      const price = priceMap[dateStr];
      if (!price || price === 0) continue;
      const tvlADA = point.tvl / price;
      const pct = (tvlADA / TOTAL_STAKED_ADA) * 100;
      if (pct > 0 && pct < 100) { // sanity check
        cardanoAllDailyData.push({ date: dateStr, pct });
      }
    }

    // Default to "All Time" view, sampled weekly
    const weekly = sampleToWeekly(cardanoAllDailyData);
    renderCardanoChart(weekly);

    $('cardano-chart-status').textContent =
      `${cardanoAllDailyData.length} daily data points loaded, showing ${weekly.length} weekly samples`;

  } catch (err) {
    console.error('Cardano historical error:', err);
    $('cardano-chart-status').textContent = 'Error loading historical data: ' + err.message;
  }

  // ── 3. Multi-chain comparison (monthly, last 12 months) ────────────────
  try {
    const comparisonDatasets = [];

    // Fetch all TVL histories in parallel (DefiLlama has no rate limit)
    const tvlHistories = {};
    const tvlPromises = COMPARISON_LINE_CHAINS.map(async chain => {
      tvlHistories[chain] = await getHistoricalTVL(chain);
    });
    await Promise.all(tvlPromises);

    // Fetch market cap histories from CoinGecko one at a time with delays
    for (const chain of COMPARISON_LINE_CHAINS) {
      try {
        const info = CHAINS[chain];
        if (!info) continue;

        // Delay to respect CoinGecko rate limits (free tier: ~10-30 req/min)
        await new Promise(r => setTimeout(r, 2500));

        const cg = await getHistoricalPricesCG(info.geckoId, 365);
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

          const mcap = cg.mcaps[dateStr];
          if (!mcap || mcap === 0) continue;

          let pct;
          if (chain === 'Cardano') {
            // Use staked-ADA denominator for Cardano
            const price = cg.prices[dateStr];
            if (!price || price === 0) continue;
            const tvlADA = point.tvl / price;
            pct = (tvlADA / TOTAL_STAKED_ADA) * 100;
          } else {
            pct = (point.tvl / mcap) * 100;
          }
          monthlyPoints.push({ x: dateStr, y: pct });
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
            borderDash: chain === 'Cardano' ? [] : [],
          });
        }
      } catch (chainErr) {
        console.warn(`Skipping ${chain} comparison:`, chainErr);
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
