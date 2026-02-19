# Auditoría de Seguridad — Bingo Game (Bolcoin)
**Fecha:** 2026-02-18
**Auditor:** Claude Opus 4.6
**Alcance:** Backend + Frontend del juego Bingo, cambios de las últimas sesiones

---

## Resumen Ejecutivo

El juego Bingo implementa un modelo **off-chain** donde el servidor es árbitro completo de resultados. Esto introduce riesgos de confianza centralizados típicos de juegos de azar tradicionales online. La seguridad del sistema depende casi completamente de la integridad del servidor backend.

**Puntuación de Riesgo Global: MEDIO-ALTO (6.5/10)**
El mayor riesgo es la aleatoriedad no verificable del servidor. La lógica de pagos y autenticación es sólida.

---

## Vulnerabilidades Encontradas

### 🔴 CRÍTICA — VRF Seed no es Verificable por el Usuario

**Archivo:** `src/services/bingoService.js:504`
```js
const vrfSeed = '0x' + crypto.randomBytes(32).toString('hex');
```

**Problema:** El servidor genera el seed con `crypto.randomBytes` internamente y luego lo almacena junto con los resultados. Los usuarios no pueden verificar que el seed fue generado *antes* de cerrar las apuestas (no hay commit-reveal scheme).

**Impacto:** Un operador malicioso podría generar múltiples seeds, elegir el más favorable y presentarlo como el "aleatorio". No hay prueba criptográfica de fairness.

**Mitigación recomendada:**
1. Publicar el hash del seed ANTES de cerrar la ronda (commit)
2. Revelar el seed completo DESPUÉS del cierre (reveal)
3. O integrar un VRF on-chain real (Chainlink VRF)

---

### ✅ RESUELTO — Atomicidad de Pagos de Premios

**Revisión post-audit:** Los pagos a usuarios SÍ estaban dentro de la transacción (usaban `client.query`, no `pool.query`). El audit inicial fue incorrecto en este punto.

**Problema real encontrado y corregido:** El read del jackpot se hacía FUERA de la transacción con `pool.query` antes del `BEGIN`. Esto permitía que dos salas que ganaran el jackpot simultáneamente leyeran el mismo balance y lo pagaran dos veces (double-jackpot).

**Fix aplicado (2026-02-18):** Se movió el read del jackpot dentro de la transacción con `SELECT ... FOR UPDATE` para bloquear la fila durante toda la operación:
```js
await client.query('BEGIN');
const poolRow = await client.query(
  'SELECT jackpot_balance FROM bingo_pool WHERE id = 1 FOR UPDATE'
);
// ... jackpot check y pagos dentro de la misma transacción
await client.query('COMMIT');
```

---

### 🟠 ALTA — Race Condition en Compra de Cartones

**Archivo:** `src/services/bingoService.js:401-408`
```js
const existingCards = await pool.query(
  'SELECT COUNT(*) AS cnt FROM bingo_cards WHERE round_id = $1 AND owner_address = $2',
  [roundId, addr]
);
const existingCount = parseInt(existingCards.rows[0].cnt);
if (existingCount + count > maxCards) {
  throw new Error(`Max ${maxCards} cards per round...`);
}
```

**Problema:** El check de límite de cartones (SELECT) y el INSERT ocurren en operaciones separadas. Sin un `SELECT ... FOR UPDATE` o `SERIALIZABLE` isolation, dos requests concurrentes del mismo usuario podrían pasar ambas el check y exceder el límite.

**Mitigación:**
```sql
BEGIN;
SELECT COUNT(*) FROM bingo_cards WHERE round_id=$1 AND owner_address=$2 FOR UPDATE;
-- luego INSERT
COMMIT;
```

---

### 🟡 MEDIA — Rate Limiting Generoso Permite Scraping de Resultados

**Archivo:** `src/routes/bingo.js:18-25`
```js
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
```

**Problema:** 120 requests/min en endpoints públicos como `/rooms` y `/rounds/:id` es suficiente para polling agresivo o scraping de datos de juego en tiempo real por actores externos.

**Mitigación:** Separar rate limits por endpoint. `/rooms` puede tener 60/min pero `/rounds/:id` debería requerir autenticación o tener límites más estrictos.

---

### 🟡 MEDIA — Información Filtrada Antes del Sorteo Completarse

**Archivo:** `src/routes/bingo.js` — endpoint `/rounds/:id`
**Archivo:** `bolcoin-frontend/src/hooks/useBingoGame.js`

**Problema:** Cuando el status es `drawing`, la API devuelve `drawn_balls` completo (75 bolas) y los campos `line_winner`, `bingo_winner`. Un jugador podría obtener estos datos vía API antes de que la animación termine en el frontend (o si llega tarde), y conocer los resultados antes del final "oficial" del sorteo.

**Estado actual:** La pantalla de resultados intenta ocultarlo, pero los datos están disponibles en la red tab del navegador.

**Mitigación:** Para `status='drawing'`, filtrar `drawn_balls` a solo los primeros N donde N = `floor((now - draw_started_at) / 4500)`. Nunca revelar los ganadores hasta `status='resolved'`.

---

### 🟡 MEDIA — Seed VRF Expuesto en Respuesta Pública

**Archivo:** `src/services/bingoService.js:589` — Se guarda `vrfSeed` en `vrf_random_word`
**Archivo:** `src/routes/bingo.js` — Respuesta de `/rounds/:id` puede incluir `vrf_random_word`

**Problema:** El seed hexadecimal original se almacena en texto plano y podría ser expuesto en las respuestas de la API. Si el seed se filtra durante el sorteo, actores sofisticados podrían calcular todos los resultados restantes al momento.

**Mitigación:** No incluir `vrf_random_word` en respuestas públicas hasta que el status sea `resolved`.

---

### 🟢 BAJA — Balance Update sin Confirmación del Servidor

**Archivo:** `bolcoin-frontend/src/contexts/BalanceContext.jsx:136-140`
```js
setEffectiveBalance(prev => {
  const dbVal = parseFloat(formatted) || 0;
  return dbVal > prevVal ? formatted : prev;
});
```

**Problema:** La lógica "si DB > prev, usar DB" puede confundirse si hay actualizaciones pendientes de otras fuentes. En escenarios multi-tab, si el usuario tiene dos ventanas abiertas y gana en una, la otra mostrará el balance incrementado al siguiente poll automático (30s), no inmediatamente.

**Impacto:** Menor — solo afecta la visualización, no los fondos reales.

---

### 🟢 BAJA — CORS y Headers de Seguridad No Verificados

No se analizaron los headers CORS y CSP del servidor en este audit. Se recomienda verificar:
- `CORS` permite solo orígenes conocidos
- `Content-Security-Policy` configurado
- `X-Frame-Options: DENY` para evitar clickjacking

---

## Análisis de Lógica de Premios

```
Revenue = totalCards * cardPrice
Fee (10%) = revenue * 0.10
Reserve (10%) = revenue * 0.10
WinnerPot (80%) = revenue * 0.80

LinePrize (15% del pot) = winnerPot * 0.15
BingoPrize (85% del pot) = winnerPot * 0.85
Total distribuido = 100% del winnerPot ✅
```

La distribución suma correctamente al 100% del pot. No queda dinero sin asignar entre linePrize y bingoPrize.

**Riesgo de co-ganadores:** Si hay múltiples ganadores de línea/bingo al mismo instante (mismo ball), el premio se divide. La lógica en `detectWinners` maneja correctamente los arrays de co-ganadores.

---

## Análisis de Autenticación

| Endpoint | Auth Requerida | Feature Flag |
|----------|----------------|--------------|
| `GET /rooms` | No | No |
| `GET /rounds/:id` | No | No |
| `POST /buy-cards` | `authenticateWallet` | `requireFlag('game_bingo')` |
| `GET /my-cards` | `authenticateWallet` | `requireFlag('game_bingo')` |
| Admin endpoints | `authenticate` + `requireAdmin` | — |

La autenticación de compras es correcta. Los endpoints públicos no exponen datos sensibles de usuarios (solo ganadores después del sorteo).

---

## Análisis del Flujo VRF

```
1. Server genera: crypto.randomBytes(32) → hex string
2. Convierte a BigInt
3. drawBallsFromVrfSeed(bigInt.toString()) → Fisher-Yates con LCG
4. Almacena seed en DB
```

El LCG usado en `generateDrawnBalls` (mismo algoritmo en frontend y backend) es determinístico. Esto es correcto para la sincronización pero el LCG no es criptográficamente seguro como PRNG. Sin embargo, dado que el seed proviene de `crypto.randomBytes(32)`, la aleatoriedad inicial es sólida.

---

## Recomendaciones Priorizadas

| Prioridad | Acción |
|-----------|--------|
| P0 | Incluir pagos de premios en la misma transacción DB de resolución |
| P1 | Implementar commit-reveal para el seed VRF (o Chainlink VRF) |
| P1 | Añadir `FOR UPDATE` en check de límite de cartones |
| P2 | Filtrar `drawn_balls` y ganadores en respuestas durante `status='drawing'` |
| P2 | Verificar headers CORS, CSP, X-Frame-Options |
| P3 | Implementar auditoría on-chain de resultados para verificabilidad pública |

---

## Conclusión

El sistema es funcionalmente seguro para un MVP. Los riesgos críticos están en la centralización de la aleatoriedad (típico de juegos off-chain) y en la atomicidad de pagos. Para un entorno de producción con dinero real, se recomienda abordar al menos los items P0 y P1.
