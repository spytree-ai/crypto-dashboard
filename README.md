# Crypto Dashboard (Railway)

Aplicación web sencilla para monitorear pares de criptomonedas desde **Binance** con:

- Precio actual en USD (pares `*USDT`).
- Vista multi-timeframe: **1D, 4H, 1H y 15m**.
- RSI 14 para cada timeframe.
- Detección de cruce de **MACD** en cada timeframe.
- Detección de cruce de **precio vs EMA21** y **precio vs EMA50** en cada timeframe.
- Tendencia por timeframe (alcista/bajista/lateral) según precio, EMA21 y EMA50.
- Panel de gráfico: selección de par + timeframe con líneas de Precio, EMA21, EMA50 y MACD/Señal.
- Lista configurable de pares (agregar/quitar) guardada en `localStorage`.
- Actualización automática configurable (15s, 30s o 60s).

## Ejecutar en local

```bash
npm install
npm start
```

Abrir: `http://localhost:3000`

## Desplegar en Railway (paso a paso para principiantes)

1. Sube este proyecto a un repositorio en GitHub.
2. Entra a [railway.app](https://railway.app/) y crea una cuenta.
3. Haz clic en **New Project** → **Deploy from GitHub repo**.
4. Selecciona tu repositorio `crypto-dashboard`.
5. Railway detectará Node.js automáticamente y ejecutará `npm start`.
6. Cuando termine el deploy, abre la URL pública que Railway te da.

> Railway usa la variable `PORT` automáticamente, y este proyecto ya la soporta.

## Notas

- Puedes escribir `BTC`, `ETH`, `SOL` o el par completo `BTCUSDT`, `ETHUSDT`, etc.
- La app normaliza entradas cortas a `USDT` (ej: `BTC` -> `BTCUSDT`).
- En cada timeframe se muestran RSI, cruce MACD, cruce de precio sobre EMA21/EMA50 y tendencia.
- Si el par no existe en Binance, verás "Error al cargar datos" en la tabla.
