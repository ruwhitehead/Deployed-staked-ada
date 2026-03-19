// ── Configuration ──────────────────────────────────────────────────────────
const CARDANO_CIRCULATING_SUPPLY = 36e9;   // ~36 billion ADA
const STAKING_RATIO = 0.60;                // ~60% staked
const TOTAL_STAKED_ADA = CARDANO_CIRCULATING_SUPPLY * STAKING_RATIO;
const TARGET_TVL_USD = 3e9;                // 2030 target: $3B

// Chains to compare (DefiLlama slug → display name)
const COMPARE_CHAINS = {
  'Ethereum':  'Ethereum',
  'Solana':    'Solana',
  'BSC':       'BSC',
  'Arbitrum':  'Arbitrum',
  'Base':      'Base',
  'Polygon':   'Polygon',
  'Avalanche': 'Avalanche',
  'Optimism':  'Optimism',
  'Sui':       'Sui',
  'Aptos':     'Aptos',
  'Tron':      'Tron',
  'Cardano':   'Cardano',
  'Thorchain': 'THORChain',
  'Mantle':    'Mantle',
};

// CoinGecko IDs for market cap lookup
const CHAIN_TO_COINGECKO = {
  'Ethereum':  'ethereum',
  'Solana':    'solana',
  'BSC':       'binancecoin',
  'Arbitrum':  'arbitrum',
  'Base':      'ethereum',       // Base doesn't have own token; uses ETH ecosystem
  'Polygon':   'matic-network',
  'Avalanche': 'avalanche-2',
  'Optimism':  'optimism',
  'Sui':       'sui',
  'Aptos':     'aptos',
  'Tron':      'tron',
  'Cardano':   'cardano',
  'Thorchain': 'thorchain',
  'Mantle':    'mantle',
};

// Distinct colours for chart lines
const CHAIN_COLORS = {
  'Ethereum':  '#627eea',
  'Solana':    '#9945ff',
  'BSC':       '#f0b90b',
  'Arbitrum':  '#28a0f0',
  'Base':      '#0052ff',
  'Polygon':   '#8247e5',
  'Avalanche': '#e84142',
  'Optimism':  '#ff0420',
  'Sui':       '#6fbcf0',
  'Aptos':     '#4cd7b0',
  'Tron':      '#ff060a',
  'Cardano':   '#3cc8c8',
  'Thorchain': '#33ff99',
  'Mantle':    '#000000',
};

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (n, decimals = 2) => {
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

/** Get current Cardano TVL (USD) from DefiLlama */
async function getCardanoTVL() {
  const chains = await fetchJSON('https://api.llama.fi/v2/chains');
  const cardano = chains.find(c => c.name === 'Cardano');
  return cardano ? cardano.tvl : null;
}

/** Get ADA price from CoinGecko */
async function getADAPrice() {
  const data = await fetchJSON(
    'https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd'
  );
  return data.cardano.usd;
}

/** Get historical TVL for a chain (daily data from DefiLlama) */
async function getHistoricalTVL(chain) {
  return fetchJSON(`https://api.llama.fi/v2/historicalChainTvl/${chain}`);
}

/** Get historical ADA prices from CoinGecko (max range) */
async function getHistoricalADAPrice() {
  const data = await fetchJSON(
    'https://api.coingecko.com/api/v3/coins/cardano/market_chart?vs_currency=usd&days=max&interval=daily'
  );
  // Returns { prices: [[timestamp, price], ...] }
  const map = {};
  for (const [ts, price] of data.prices) {
    const dateStr = new Date(ts).toISOString().slice(0, 10);
    map[dateStr] = price;
  }
  return map;
}

/** Get current market caps for comparison chains */
async function getMarketCaps() {
  const ids = [...new Set(Object.values(CHAIN_TO_COINGECKO))].join(',');
  const data = await fetchJSON(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true`
  );
  const caps = {};
  for (const [chain, geckoId] of Object.entries(CHAIN_TO_COINGECKO)) {
    if (data[geckoId]) {
      caps[chain] = data[geckoId].usd_market_cap;
    }
  }
  return caps;
}

/** Get historical market cap for a coin (CoinGecko) */
async function getHistoricalMarketCap(geckoId) {
  const data = await fetchJSON(
    `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=365&interval=daily`
  );
  const map = {};
  for (const [ts, cap] of data.market_caps) {
    const dateStr = new Date(ts).toISOString().slice(0, 10);
    map[dateStr] = cap;
  }
  return map;
}

// ── Sampling helpers ───────────────────────────────────────────────────────

/** Sample daily data down to weekly (every 7th point) */
function sampleWeekly(dailyData) {
  return dailyData.filter((_, i) => i % 7 === 0);
}

/** Sample daily data down to monthly (first entry per month) */
function sampleMonthly(dailyData) {
  const seen = new Set();
  return dailyData.filter(d => {
    const month = new Date(d.date * 1000).toISOString().slice(0, 7);
    if (seen.has(month)) return false;
    seen.add(month);
    return true;
  });
}

// ── Chart rendering ────────────────────────────────────────────────────────

function renderCardanoChart(weeklyData) {
  const ctx = $('cardano-chart').getContext('2d');
  new Chart(ctx, {
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
        pointRadius: 0,
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
          time: { unit: 'month', tooltipFormat: 'MMM yyyy' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af' },
        },
        y: {
          title: { display: true, text: '% Deployed', color: '#9ca3af' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#9ca3af',
            callback: v => v.toFixed(1) + '%',
          },
        }
      },
      plugins: {
        legend: { labels: { color: '#e4e4e7' } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`,
          }
        }
      }
    }
  });
}

function renderComparisonChart(datasets) {
  const ctx = $('comparison-chart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
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
          labels: { color: '#e4e4e7', usePointStyle: true, pointStyle: 'line' },
          position: 'bottom',
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`,
          }
        }
      }
    }
  });
}

function renderBarChart(chainData) {
  // Sort by percentage descending
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
          ticks: { color: '#e4e4e7' },
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

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  $('last-updated').textContent = new Date().toLocaleString();

  // ── 1. Current Cardano snapshot ────────────────────────────────────────
  try {
    const [tvlUSD, adaPrice] = await Promise.all([getCardanoTVL(), getADAPrice()]);

    const tvlADA = tvlUSD / adaPrice;
    const deployedPct = (tvlADA / TOTAL_STAKED_ADA) * 100;

    $('cardano-pct').textContent = deployedPct.toFixed(2) + '%';
    $('cardano-detail').textContent =
      `${fmt(tvlADA)} ADA deployed out of ${fmt(TOTAL_STAKED_ADA)} staked ADA`;
    $('tvl-usd').textContent = '$' + fmt(tvlUSD);
    $('tvl-ada').textContent = fmt(tvlADA) + ' ADA';
    $('staked-ada').textContent = fmt(TOTAL_STAKED_ADA) + ' ADA';
    $('ada-price').textContent = '$' + adaPrice.toFixed(4);
    $('target-progress').textContent =
      `Current: $${fmt(tvlUSD)} (${((tvlUSD / TARGET_TVL_USD) * 100).toFixed(1)}% of target)`;
  } catch (err) {
    console.error('Snapshot error:', err);
    $('cardano-pct').textContent = 'Error';
  }

  // ── 2. Cardano historical chart (weekly) ───────────────────────────────
  try {
    const [histTVL, histPrice] = await Promise.all([
      getHistoricalTVL('Cardano'),
      getHistoricalADAPrice(),
    ]);

    // Build daily deployed % data
    const dailyData = [];
    for (const point of histTVL) {
      const dateStr = new Date(point.date * 1000).toISOString().slice(0, 10);
      const price = histPrice[dateStr];
      if (!price || price === 0) continue;
      const tvlADA = point.tvl / price;
      const pct = (tvlADA / TOTAL_STAKED_ADA) * 100;
      dailyData.push({ date: dateStr, pct });
    }

    // Sample to weekly
    const weekly = dailyData.filter((_, i) => i % 7 === 0);
    renderCardanoChart(weekly);
  } catch (err) {
    console.error('Cardano historical error:', err);
  }

  // ── 3. Multi-chain comparison (monthly, last 12 months) ────────────────
  try {
    // Get current TVLs and market caps for bar chart
    const [allChains, marketCaps] = await Promise.all([
      fetchJSON('https://api.llama.fi/v2/chains'),
      getMarketCaps(),
    ]);

    // Bar chart data
    const barData = [];
    for (const [slug, name] of Object.entries(COMPARE_CHAINS)) {
      const chain = allChains.find(c => c.name === slug);
      const mcap = marketCaps[slug];
      if (chain && mcap && mcap > 0) {
        barData.push({ name, pct: (chain.tvl / mcap) * 100 });
      }
    }
    renderBarChart(barData);

    // Historical comparison lines — fetch TVL history for each chain
    // We limit to a subset to avoid rate-limiting on CoinGecko
    const priorityChains = ['Ethereum', 'Solana', 'BSC', 'Cardano', 'Avalanche', 'Sui', 'Arbitrum', 'Optimism'];

    const comparisonDatasets = [];

    for (const chain of priorityChains) {
      try {
        const geckoId = CHAIN_TO_COINGECKO[chain];
        if (!geckoId) continue;

        // Small delay between CoinGecko requests to respect rate limits
        await new Promise(r => setTimeout(r, 1200));

        const [histTVL, histMcap] = await Promise.all([
          getHistoricalTVL(chain),
          getHistoricalMarketCap(geckoId),
        ]);

        // Filter to last ~12 months and sample monthly
        const oneYearAgo = Date.now() / 1000 - 365 * 86400;
        const recent = histTVL.filter(p => p.date >= oneYearAgo);

        const monthlyPoints = [];
        const seenMonths = new Set();
        for (const point of recent) {
          const dateStr = new Date(point.date * 1000).toISOString().slice(0, 10);
          const monthKey = dateStr.slice(0, 7);
          if (seenMonths.has(monthKey)) continue;
          seenMonths.add(monthKey);

          const mcap = histMcap[dateStr];
          if (!mcap || mcap === 0) continue;
          const pct = (point.tvl / mcap) * 100;
          monthlyPoints.push({ x: dateStr, y: pct });
        }

        comparisonDatasets.push({
          label: COMPARE_CHAINS[chain],
          data: monthlyPoints,
          borderColor: CHAIN_COLORS[chain] || '#888',
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 3,
          pointHitRadius: 10,
          borderWidth: chain === 'Cardano' ? 3 : 1.5,
        });
      } catch (chainErr) {
        console.warn(`Skipping ${chain} comparison:`, chainErr);
      }
    }

    renderComparisonChart(comparisonDatasets);
  } catch (err) {
    console.error('Comparison error:', err);
  }
}

main();
