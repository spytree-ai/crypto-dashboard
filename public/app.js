const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const storageKey = 'trackedSymbols';

const form = document.getElementById('crypto-form');
const input = document.getElementById('crypto-input');
const tableBody = document.getElementById('crypto-table-body');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh-btn');
const intervalSelect = document.getElementById('interval-select');

let trackedSymbols = loadSymbols();
let intervalId;

function normalizeSymbol(rawValue) {
  const cleaned = rawValue.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  if (cleaned.endsWith('USDT')) return cleaned;
  return `${cleaned}USDT`;
}

function loadSymbols() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return [...defaultSymbols];

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.length) return [...defaultSymbols];
    return parsed.map((symbol) => normalizeSymbol(symbol)).filter(Boolean);
  } catch {
    return [...defaultSymbols];
  }
}

function saveSymbols() {
  localStorage.setItem(storageKey, JSON.stringify(trackedSymbols));
}

function calculateRSI(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = prices[i] - prices[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i += 1) {
    const delta = prices[i] - prices[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function rsiBadge(rsiValue) {
  if (rsiValue == null) return '<span class="badge">Sin datos</span>';
  if (rsiValue > 70) return `<span class="badge overbought">${rsiValue.toFixed(2)} · Sobrecompra</span>`;
  if (rsiValue < 30) return `<span class="badge oversold">${rsiValue.toFixed(2)} · Sobreventa</span>`;
  return `<span class="badge neutral">${rsiValue.toFixed(2)} · Neutral</span>`;
}


function getReferencePrice24h(klinesData) {
  const targetTime = Date.now() - 24 * 60 * 60 * 1000;
  let bestPrice = null;
  let bestDistance = Infinity;

  for (const kline of klinesData) {
    const closeTime = Number(kline[6]);
    const closePrice = Number(kline[4]);

    if (!Number.isFinite(closeTime) || !Number.isFinite(closePrice)) {
      continue;
    }

    const distance = Math.abs(closeTime - targetTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPrice = closePrice;
    }
  }

  return bestPrice;
}

function formatPair(symbol) {
  if (symbol.endsWith('USDT')) {
    return `${symbol.slice(0, -4)}/USDT`;
  }
  return symbol;
}

async function fetchSymbolData(symbol) {
  const [tickerRes, klinesRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`),
  ]);

  if (!tickerRes.ok || !klinesRes.ok) {
    throw new Error(`No se pudo obtener ${symbol}`);
  }

  const tickerData = await tickerRes.json();
  const klinesData = await klinesRes.json();

  if (!tickerData.symbol || !Array.isArray(klinesData)) {
    throw new Error(`Par no encontrado: ${symbol}`);
  }

  const closePrices = klinesData.map((kline) => Number(kline[4])).filter((price) => Number.isFinite(price));

  const lastPrice = Number(tickerData.lastPrice);
  const referencePrice24h = getReferencePrice24h(klinesData);
  const change24h = Number.isFinite(referencePrice24h) && referencePrice24h > 0
    ? ((lastPrice - referencePrice24h) / referencePrice24h) * 100
    : Number(tickerData.priceChangePercent);

  return {
    symbol: tickerData.symbol,
    pairLabel: formatPair(tickerData.symbol),
    price: lastPrice,
    change24h,
    rsi: calculateRSI(closePrices),
  };
}

async function renderTable() {
  if (!trackedSymbols.length) {
    tableBody.innerHTML = '<tr><td colspan="5">No hay pares configurados.</td></tr>';
    statusEl.textContent = 'Agrega un par para empezar (ej: BTC o BTCUSDT).';
    return;
  }

  statusEl.textContent = `Actualizando ${trackedSymbols.length} pares desde Binance...`;
  const results = await Promise.allSettled(trackedSymbols.map((symbol) => fetchSymbolData(symbol)));

  const rows = results
    .map((result, index) => {
      const symbol = trackedSymbols[index];

      if (result.status === 'rejected') {
        return `<tr>
          <td>${formatPair(symbol)}</td>
          <td colspan="3">Error al cargar datos</td>
          <td><button data-remove="${symbol}">Quitar</button></td>
        </tr>`;
      }

      const item = result.value;
      const changeClass = item.change24h >= 0 ? 'up' : 'down';
      const changeSign = item.change24h >= 0 ? '+' : '';

      return `<tr>
        <td>${item.pairLabel}</td>
        <td>$${item.price.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
        <td class="${changeClass}">${changeSign}${item.change24h.toFixed(2)}%</td>
        <td>${rsiBadge(item.rsi)}</td>
        <td><button data-remove="${item.symbol}">Quitar</button></td>
      </tr>`;
    })
    .join('');

  tableBody.innerHTML = rows;
  statusEl.textContent = `Última actualización: ${new Date().toLocaleTimeString()}`;
}

function resetAutoRefresh() {
  clearInterval(intervalId);
  const seconds = Number(intervalSelect.value);
  intervalId = setInterval(renderTable, seconds * 1000);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const symbol = normalizeSymbol(input.value);

  if (!symbol) return;

  if (trackedSymbols.includes(symbol)) {
    statusEl.textContent = `${symbol} ya está en la lista.`;
    return;
  }

  trackedSymbols.push(symbol);
  saveSymbols();
  input.value = '';
  await renderTable();
});

refreshBtn.addEventListener('click', renderTable);
intervalSelect.addEventListener('change', resetAutoRefresh);

tableBody.addEventListener('click', async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement)) return;

  const symbol = target.getAttribute('data-remove');
  if (!symbol) return;

  trackedSymbols = trackedSymbols.filter((item) => item !== symbol);
  saveSymbols();
  await renderTable();
});

renderTable();
resetAutoRefresh();
