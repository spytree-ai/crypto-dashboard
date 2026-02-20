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
const chartSymbolSelect = document.getElementById('chart-symbol-select');
const chartTimeframeSelect = document.getElementById('chart-timeframe-select');
const priceChart = document.getElementById('price-chart');
const indicatorChart = document.getElementById('indicator-chart');

let trackedSymbols = loadSymbols();
let intervalId;
const chartCache = {};

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
  if (!Array.isArray(prices) || prices.length <= period) return null;

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
  if (!Array.isArray(values) || values.length < period) return [];

  const multiplier = 2 / (period + 1);
  const emaResult = [];
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      emaResult.push(null);
      continue;
    }

    if (i === period - 1) {
      emaResult.push(ema);
      continue;
    }

    ema = (values[i] - ema) * multiplier + ema;
    emaResult.push(ema);
  }

  return emaResult;
}

function detectCross(prevA, currA, prevB, currB) {
  if (![prevA, currA, prevB, currB].every(Number.isFinite)) return 'Sin datos';

  const prevDiff = prevA - prevB;
  const currDiff = currA - currB;

  if (prevDiff <= 0 && currDiff > 0) return 'Cruce alcista';
  if (prevDiff >= 0 && currDiff < 0) return 'Cruce bajista';
  return 'Sin cruce';
}

function calculateMACD(closes) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = closes.map((_, index) => {
    if (!Number.isFinite(ema12[index]) || !Number.isFinite(ema26[index])) return null;
    return ema12[index] - ema26[index];
  });

  const validMacd = macdLine.filter(Number.isFinite);
  const signalPartial = calculateEMA(validMacd, 9);

  const signalLine = [];
  let signalIndex = 0;
  for (let i = 0; i < macdLine.length; i += 1) {
    if (Number.isFinite(macdLine[i])) {
      signalLine.push(signalPartial[signalIndex] ?? null);
      signalIndex += 1;
    } else {
      signalLine.push(null);
    }
  }

  return { macdLine, signalLine };
}

function calculateTrend(lastPrice, ema21Value, ema50Value) {
  if (![lastPrice, ema21Value, ema50Value].every(Number.isFinite)) return 'Sin datos';
  if (lastPrice > ema21Value && ema21Value > ema50Value) return 'Alcista';
  if (lastPrice < ema21Value && ema21Value < ema50Value) return 'Bajista';
  return 'Lateral';
}

function formatPair(symbol) {
  if (symbol.endsWith('USDT')) return `${symbol.slice(0, -4)}/USDT`;
  return symbol;
}

function signalClass(text) {
  if (text === 'Cruce alcista' || text === 'Alcista') return 'up';
  if (text === 'Cruce bajista' || text === 'Bajista') return 'down';
  return '';
}

function timeframeCell(data) {
  if (!data) return 'Sin datos';

  const rsiText = Number.isFinite(data.rsi) ? data.rsi.toFixed(2) : 'Sin datos';
  const macdClass = signalClass(data.macdCross);
  const ema21Class = signalClass(data.priceEma21Cross);
  const ema50Class = signalClass(data.priceEma50Cross);
  const trendClass = signalClass(data.trend);

  return `<div class="tf-cell">
    <div>RSI: <strong>${rsiText}</strong></div>
    <div class="${macdClass}">MACD: ${data.macdCross}</div>
    <div class="${ema21Class}">Precio/EMA21: ${data.priceEma21Cross}</div>
    <div class="${ema50Class}">Precio/EMA50: ${data.priceEma50Cross}</div>
    <div class="${trendClass}">Tendencia: ${data.trend}</div>
  </div>`;
}

async function fetchTimeframeIndicators(symbol, interval, lastPrice) {
  const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`);
  if (!klinesRes.ok) throw new Error(`No se pudo obtener ${symbol} ${interval}`);

  const klinesData = await klinesRes.json();
  if (!Array.isArray(klinesData) || !klinesData.length) throw new Error(`Sin velas para ${symbol} ${interval}`);

  const closes = klinesData.map((kline) => Number(kline[4])).filter(Number.isFinite);
  if (closes.length) closes[closes.length - 1] = lastPrice;

  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const { macdLine, signalLine } = calculateMACD(closes);

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const lastEma21 = ema21[ema21.length - 1];
  const prevEma21 = ema21[ema21.length - 2];
  const lastEma50 = ema50[ema50.length - 1];
  const prevEma50 = ema50[ema50.length - 2];

  const macdCross = detectCross(
    macdLine[macdLine.length - 2],
    macdLine[macdLine.length - 1],
    signalLine[signalLine.length - 2],
    signalLine[signalLine.length - 1],
  );

  const data = {
    rsi: calculateRSI(closes),
    macdCross,
    priceEma21Cross: detectCross(prevClose, lastClose, prevEma21, lastEma21),
    priceEma50Cross: detectCross(prevClose, lastClose, prevEma50, lastEma50),
    trend: calculateTrend(lastClose, lastEma21, lastEma50),
    series: {
      closes,
      ema21,
      ema50,
      macdLine,
      signalLine,
    },
  };

  return data;
}

function updateChartSelectors() {
  const previous = chartSymbolSelect.value;
  chartSymbolSelect.innerHTML = trackedSymbols
    .map((symbol) => `<option value="${symbol}">${formatPair(symbol)}</option>`)
    .join('');

  if (trackedSymbols.includes(previous)) {
    chartSymbolSelect.value = previous;
  }
}

function drawLineSeries(ctx, values, color, minY, maxY, width, height) {
  const points = values
    .map((value, index) => ({ value, index }))
    .filter((item) => Number.isFinite(item.value));

  if (!points.length) return;

  ctx.beginPath();
  points.forEach((point, idx) => {
    const x = (point.index / (values.length - 1 || 1)) * width;
    const y = height - ((point.value - minY) / (maxY - minY || 1)) * height;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

function drawChartForSelection() {
  const symbol = chartSymbolSelect.value;
  const interval = chartTimeframeSelect.value;

  const cacheEntry = chartCache[symbol]?.[interval];
  const priceCtx = priceChart.getContext('2d');
  const indicatorCtx = indicatorChart.getContext('2d');

  priceCtx.clearRect(0, 0, priceChart.width, priceChart.height);
  indicatorCtx.clearRect(0, 0, indicatorChart.width, indicatorChart.height);

  if (!cacheEntry) {
    priceCtx.fillStyle = '#9ca3af';
    priceCtx.fillText('Sin datos para el gráfico.', 20, 24);
    return;
  }

  const { closes, ema21, ema50, macdLine, signalLine } = cacheEntry.series;

  const priceValues = closes.concat(ema21.filter(Number.isFinite), ema50.filter(Number.isFinite));
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);

  drawLineSeries(priceCtx, closes, '#e5e7eb', minPrice, maxPrice, priceChart.width, priceChart.height);
  drawLineSeries(priceCtx, ema21, '#f59e0b', minPrice, maxPrice, priceChart.width, priceChart.height);
  drawLineSeries(priceCtx, ema50, '#60a5fa', minPrice, maxPrice, priceChart.width, priceChart.height);

  const indicatorValues = macdLine.concat(signalLine).filter(Number.isFinite);
  if (indicatorValues.length) {
    const minInd = Math.min(...indicatorValues);
    const maxInd = Math.max(...indicatorValues);
    drawLineSeries(indicatorCtx, macdLine, '#34d399', minInd, maxInd, indicatorChart.width, indicatorChart.height);
    drawLineSeries(indicatorCtx, signalLine, '#ef4444', minInd, maxInd, indicatorChart.width, indicatorChart.height);
  }

  priceCtx.fillStyle = '#9ca3af';
  priceCtx.fillText('Precio (blanco) · EMA21 (naranja) · EMA50 (azul)', 16, 20);
  indicatorCtx.fillStyle = '#9ca3af';
  indicatorCtx.fillText('MACD (verde) · Señal (rojo)', 16, 20);
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

  chartCache[symbol] = chartCache[symbol] || {};
  timeframes.forEach((tf) => {
    if (timeframeMap[tf.label]) {
      chartCache[symbol][tf.interval] = timeframeMap[tf.label];
    }
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
    updateChartSelectors();
    drawChartForSelection();
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
  updateChartSelectors();
  drawChartForSelection();
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
chartSymbolSelect.addEventListener('change', drawChartForSelection);
chartTimeframeSelect.addEventListener('change', drawChartForSelection);

tableBody.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const symbol = target.getAttribute('data-remove');
  if (!symbol) return;

  trackedSymbols = trackedSymbols.filter((item) => item !== symbol);
  saveSymbols();
  delete chartCache[symbol];
  await renderTable();
});

renderTable();
resetAutoRefresh();
