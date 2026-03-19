# Deployed Staked ADA Dashboard

A live dashboard tracking what percentage of staked ADA is actively deployed in Cardano's DeFi ecosystem, with comparisons to other Layer 1 blockchains.

## What it shows

1. **Current snapshot** — live percentage of staked ADA deployed in DeFi, plus TVL in USD/ADA, staking stats, and progress toward the 2030 $3B TVL target
2. **Cardano historical chart** — weekly trend of deployed staked ADA % over time
3. **Ecosystem comparison chart** — monthly TVL/Market Cap ratio for major blockchains over the past year
4. **Current comparison bar chart** — ranked deployment % across ecosystems

## Methodology

- **Cardano**: `(DeFi TVL in ADA ÷ Total Staked ADA) × 100`
- **Other chains**: `(DeFi TVL in USD ÷ Market Cap) × 100`

## Data sources

| Source | What it provides |
|--------|-----------------|
| [DefiLlama](https://defillama.com) | TVL (current + historical) for all chains |
| [CoinGecko](https://www.coingecko.com) | Token prices, market caps (current + historical) |
| [Cexplorer](https://cexplorer.io) | Cardano staking reference data |

## Running locally

Just open `index.html` in a browser. No build step required — it's a static site that fetches live data from public APIs.

## Deployment

Hosted via GitHub Pages. Visit the live dashboard at the repository's GitHub Pages URL.

## Background

As of early 2026, roughly 2.4% of staked ADA is deployed in DeFi — compared to 10–20% for competing L1 ecosystems. This dashboard makes that gap visible and trackable over time.
