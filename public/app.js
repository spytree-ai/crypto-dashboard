const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const storageKey = 'trackedSymbols';
const timeframes = [
  { label: '1D', interval: '1d' },
  { label: '4H', interval: '4h' },
  { label: '1H', interval: '1h' },
  { label: '15m', interval: '15m' },
];

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

function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const result = [];
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }

    if (i === period - 1) {
      result.push(ema);
      continue;
    }

    ema = (values[i] - ema) * multiplier + ema;
    result.push(ema);
  }

  return result;
}

function detectCross(prevA, currA, prevB, currB) {
  if (![prevA, currA, prevB, currB].every(Number.isFinite)) {
    return 'Sin datos';
  }

  const prevDiff = prevA - prevB;
  const currDiff = currA - currB;

  if (prevDiff <= 0 && currDiff > 0) return 'Cruce alcista';
  if (prevDiff >= 0 && currDiff < 0) return 'Cruce bajista';
  return 'Sin cruce';
}

function calculateMACDCross(closes) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = closes.map((_, index) => {
    if (!Number.isFinite(ema12[index]) || !Number.isFinite(ema26[index])) {
      return null;
    }
    return ema12[index] - ema26[index];
  });

  const validMacd = macdLine.filter(Number.isFinite);
  const signalPartial = calculateEMA(validMacd, 9);

  if (signalPartial.length < 2 || validMacd.length < 2) {
    return 'Sin datos';
  }

  const prevMacd = validMacd[validMacd.length - 2];
  const currMacd = validMacd[validMacd.length - 1];
  const prevSignal = signalPartial[signalPartial.length - 2];
  const currSignal = signalPartial[signalPartial.length - 1];

  return detectCross(prevMacd, currMacd, prevSignal, currSignal);
}

function calculateEMACross(closes) {
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);

  if (ema21.length < 2 || ema50.length < 2) {
    return 'Sin datos';
  }

  const prev21 = ema21[ema21.length - 2];
  const curr21 = ema21[ema21.length - 1];
  const prev50 = ema50[ema50.length - 2];
  const curr50 = ema50[ema50.length - 1];

  return detectCross(prev21, curr21, prev50, curr50);
}

function formatPair(symbol) {
  if (symbol.endsWith('USDT')) return `${symbol.slice(0, -4)}/USDT`;
  return symbol;
}

function signalClass(text) {
  if (text === 'Cruce alcista') return 'up';
  if (text === 'Cruce bajista') return 'down';
  return '';
}

function timeframeCell(data) {
  if (!data) return 'Sin datos';

  const rsiText = Number.isFinite(data.rsi) ? data.rsi.toFixed(2) : 'Sin datos';
  const macdClass = signalClass(data.macdCross);
  const emaClass = signalClass(data.emaCross);

  return `<div class="tf-cell">
    <div>RSI: <strong>${rsiText}</strong></div>
    <div class="${macdClass}">MACD: ${data.macdCross}</div>
    <div class="${emaClass}">EMA21/50: ${data.emaCross}</div>
  </div>`;
}

async function fetchTimeframeIndicators(symbol, interval, lastPrice) {
  const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=250`);

  if (!klinesRes.ok) {
    throw new Error(`No se pudo obtener ${symbol} ${interval}`);
  }

  const klinesData = await klinesRes.json();
  if (!Array.isArray(klinesData) || !klinesData.length) {
    throw new Error(`Sin velas para ${symbol} ${interval}`);
  }

  const closes = klinesData.map((kline) => Number(kline[4])).filter((price) => Number.isFinite(price));
  if (closes.length) {
    closes[closes.length - 1] = lastPrice;
  }

  return {
    rsi: calculateRSI(closes),
    macdCross: calculateMACDCross(closes),
    emaCross: calculateEMACross(closes),
  };
}

async function fetchSymbolData(symbol) {
  const tickerRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
  if (!tickerRes.ok) throw new Error(`No se pudo obtener ${symbol}`);

  const tickerData = await tickerRes.json();
  if (!tickerData.symbol) throw new Error(`Par no encontrado: ${symbol}`);

  const lastPrice = Number(tickerData.price);

  const timeframeResults = await Promise.allSettled(
    timeframes.map((tf) => fetchTimeframeIndicators(symbol, tf.interval, lastPrice)),
  );

  const timeframeMap = {};
  timeframes.forEach((tf, index) => {
    timeframeMap[tf.label] = timeframeResults[index].status === 'fulfilled'
      ? timeframeResults[index].value
      : null;
  });

  return {
    symbol: tickerData.symbol,
    pairLabel: formatPair(tickerData.symbol),
    price: lastPrice,
    timeframes: timeframeMap,
  };
}

async function renderTable() {
  if (!trackedSymbols.length) {
    tableBody.innerHTML = '<tr><td colspan="7">No hay pares configurados.</td></tr>';
    statusEl.textContent = 'Agrega un par para empezar (ej: BTC o BTCUSDT).';
    return;
  }

  statusEl.textContent = `Actualizando ${trackedSymbols.length} pares con señales multi-timeframe...`;
  const results = await Promise.allSettled(trackedSymbols.map((symbol) => fetchSymbolData(symbol)));

  const rows = results
    .map((result, index) => {
      const symbol = trackedSymbols[index];

      if (result.status === 'rejected') {
        return `<tr>
          <td>${formatPair(symbol)}</td>
          <td colspan="5">Error al cargar datos</td>
          <td><button data-remove="${symbol}">Quitar</button></td>
        </tr>`;
      }

      const item = result.value;

      return `<tr>
        <td>${item.pairLabel}</td>
        <td>$${item.price.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
        <td>${timeframeCell(item.timeframes['1D'])}</td>
        <td>${timeframeCell(item.timeframes['4H'])}</td>
        <td>${timeframeCell(item.timeframes['1H'])}</td>
        <td>${timeframeCell(item.timeframes['15m'])}</td>
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
