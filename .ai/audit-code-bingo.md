# Auditoría de Calidad de Código — Bingo Game (Bolcoin)
**Fecha:** 2026-02-18
**Auditor:** Claude Opus 4.6
**Alcance:** Backend services, routes y frontend hooks/contexts del juego Bingo

---

## Resumen

El código es limpio y bien organizado para un MVP. Hay algunos hooks con dependencias problemáticas y race conditions potenciales en operaciones asíncronas. La función `calcSyncState` es el punto más sólido del sistema — pura, testeable y correcta. El mayor riesgo de bugs está en el manejo de estado del `BalanceContext`.

**Calificación de Calidad: 7/10**

---

## 1. Backend — `bingoService.js`

### Problemas encontrados

**🔴 Bug potencial: Pagos fuera de transacción**
```js
// Línea ~620: Esta transacción hace COMMIT antes de los pagos
await client.query('COMMIT');
client.release(); // ← cliente liberado

// Línea ~650: Pagos ocurren DESPUÉS, en queries separadas
for (const winner of winners.lineWinners) {
  await pool.query(
    'UPDATE users SET balance = balance + $1 WHERE wallet_address = $2',
    [linePrizePerWinner, winner.owner]
  );
}
```

Si el proceso falla entre el `COMMIT` y los pagos, los ganadores no reciben su premio pero la ronda queda marcada como `drawing`. Los pagos deben estar dentro de la misma transacción.

**🟡 N+1 Query en checkCard durante resolución**
```js
for (const card of cards) {
  const result = checkCard(card.numbers, drawnBalls); // CPU — OK
  // Pero luego:
  await client.query('UPDATE bingo_cards SET ... WHERE card_id = $1', [card.cardId]);
}
```

Para rondas con muchos cartones, esto genera N queries secuenciales. Mejor usar `INSERT ... VALUES ... ON CONFLICT DO UPDATE` en batch.

**🟢 Bien hecho: Transacción de compra correcta**
```js
await client.query('BEGIN');
// CHECK balance
// DEDUCT balance (con balance >= $1 en WHERE para atomic check)
// INSERT cards
// UPDATE round totals
await client.query('COMMIT');
```
La transacción de compra usa `balance >= $1` en el WHERE del UPDATE para garantizar atomicidad — correcto y seguro.

---

## 2. Backend — `bingoScheduler.js`

### Problemas encontrados

**🟡 Constants hardcodeadas no consistentes con config**
```js
const BALL_INTERVAL_MS = 4500;  // ← hardcoded
const LINE_PAUSE_MS = 5000;     // ← hardcoded
const BINGO_PAUSE_MS = 6000;    // ← hardcoded
```
Estos valores deben coincidir exactamente con los del frontend (`useBingoGame.js`). Si se cambia uno sin el otro, hay desincronización. Deberían leerse de una fuente compartida (config en DB o archivo de constantes).

**🟡 Sin manejo de rondas huérfanas en estado `drawing`**
```js
async function start() {
  // No hay lógica para recuperar rondas que quedaron en 'drawing'
  // si el servidor se reinició durante una animación
}
```

**🟢 Bien hecho: Loop de rooms con catch y retry**
```js
} catch (err) {
  console.error(`[BingoScheduler] Room ${roomNumber} error:`, err.message);
  await sleep(10000); // Retry después de 10s
}
```
Los errores no matan el loop — la sala se recupera sola.

---

## 3. Frontend — `useBingoGame.js`

### Análisis de useEffects y dependencias

**🔴 Race condition en animación**
```js
useEffect(() => {
  // ...
  const syncInterval = setInterval(() => {
    // ...
    setCurrentBallIndex(prev => {
      if (ballIndex < prev) return prev;
      setAnimatedBalls(drawnBalls.slice(0, ballIndex + 1)); // ← setState dentro de setState
      return ballIndex;
    });
  }, 1000);

  return () => clearInterval(syncInterval);
}, [drawnBalls, drawStartedAt, lineWinnerBallPos, bingoWinnerBallPos]); // gameState no está
```

Llamar `setAnimatedBalls` dentro del updater de `setCurrentBallIndex` es un anti-patrón. El updater de React debe ser puro y sin efectos secundarios. Esto puede causar renders dobles en StrictMode.

**Corrección:**
```js
setCurrentBallIndex(ballIndex);
setAnimatedBalls(drawnBalls.slice(0, ballIndex + 1));
```
(Separar las dos llamadas setState)

**🟡 `gameStateRef` actualizado implícitamente**
```js
// gameStateRef se usa para evitar re-renders pero no se ve dónde se actualiza
if (gameStateRef.current !== BINGO_STATES.RESOLVED) {
```

Si `gameStateRef` se actualiza con `useEffect` que depende de `gameState`, pero `gameState` puede estar desactualizado dentro del `setInterval` (closure stale), puede haber inconsistencias.

**🟡 `refreshBalance` en la lista de dependencias del poll**
```js
}, [selectedRound, gameState, showInfo, refreshBalance, loadDatabaseBalance]);
```

`refreshBalance` es una función que cambia referencia en cada render (aunque esté memoizada con `useCallback`). Si alguna de las dependencias de `refreshBalance` cambia (ej: `isConnected`), el poll se reiniciará. Esto es generalmente inofensivo pero puede causar flickers.

**🟢 Bien hecho: `gameStateRef` para evitar stale closures**
```js
const gameStateRef = useRef(gameState);
useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
```
Correcto patrón para leer estado dentro de closures sin staleness.

**🟢 Bien hecho: `calcSyncState` como función pura externa**
Al estar fuera del componente, `calcSyncState` no crea referencias nuevas en cada render.

---

## 4. Frontend — `BalanceContext.jsx`

### Análisis del fix de balance

**🟡 Lógica "el mayor gana" puede ser incorrecta**
```js
setEffectiveBalance(prev => {
  const prevVal = parseFloat(prev) || 0;
  const dbVal = parseFloat(formatted) || 0;
  return dbVal > prevVal ? formatted : prev;
});
```

**Problema:** El `effectiveBalance` debería ser `DB balance + keno session netResult`. Si:
- DB balance = $100 (después de ganar bingo)
- Keno session netResult = -$20 (pérdidas pendientes de keno)
- effectiveBalance real = $80

Pero con esta lógica, si el prev era $80 y el DB es $100, se usaría $100, mostrando un balance "inflado".

**Cuando ocurre:** Solo si el usuario tiene pérdidas de keno sin settlare Y luego gana bingo. Es un edge case raro pero técnicamente incorrecto.

**🟡 `loadDatabaseBalance` tiene closure sobre `account` pero `effectiveBalance` no**
```js
const loadDatabaseBalance = useCallback(async () => {
  // ...
  setEffectiveBalance(prev => { ... }); // Lee prev via setter, OK
}, [isConnected, account]);
```
El patrón de setter funcional (`prev =>`) es correcto para evitar closures stale en el estado.

**🟢 Bien hecho: `updateBalanceOptimistic` actualiza los 3 estados**
```js
const updateBalanceOptimistic = useCallback((change) => {
  setContractBalance(prev => ...);
  setEffectiveBalance(prev => ...);   // ← Añadido en fix
  setOffChainBalance(prev => ...);    // ← Añadido en fix
}, []);
```

---

## 5. Tests Actuales y Coverage

### Tests existentes
- `bingoResolverService.test.js` — 28 tests para funciones puras ✅
- `src/__tests__/setup.js` — configuración de Jest

### Tests que faltan (alta prioridad)

| Test | Cobertura que falta |
|------|---------------------|
| `calcSyncState` unit tests | elapsedMs negativo, ballIndex en boundaries |
| `bingoService.resolveRoundOffChain` | integración con DB mock |
| `bingoScheduler` room loop | simulación de ciclo completo |
| `BalanceContext` | comportamiento con bingo win |
| Race conditions en buyCards | requests concurrentes del mismo usuario |

### Tests que deberían añadirse a `bingoResolverService.test.js`
```js
it('calcSyncState handles negative elapsed (clock skew)', () => {
  const result = calcSyncState(-1000, 0, 10, 75);
  expect(result.ballIndex).toBeGreaterThanOrEqual(0);
});

it('calcSyncState lineWinnerBall === bingoWinnerBall edge case', () => {
  // Matemáticamente imposible pero el código debe no romperse
  const result = calcSyncState(50000, 10, 10, 75);
  expect(result.phase).toBeDefined();
});
```

---

## 6. Código Duplicado

### `makeBallsWithEarly` duplicada en tests
```js
// Definida dos veces en bingoResolverService.test.js:
// - línea 100 (en describe checkCard)
// - línea 174 (en describe detectWinners)
```
Mover a una función helper en el scope del `describe` principal.

### Mismos fallbacks de BPS en 4 lugares
```js
// bingoService.js:518:     config.linePrizeBps || 1500
// routes/bingo.js:~130:   linePrizeBps: config.linePrizeBps || 1500
// RoomCard.jsx:34:         room.linePrizeBps || 1500
// BingoRoom.jsx:~200:      linePrizeBps || 1500
```
Centralizar en una constante compartida o asegurarse de que la config siempre tenga valores.

---

## 7. Análisis de `generateDrawnBalls` (LCG)

```js
function generateDrawnBalls(randomWord) {
  const balls = Array.from({ length: 75 }, (_, i) => i + 1);
  let seed = BigInt(randomWord);

  for (let i = 74; i > 0; i--) {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    const j = Number(seed % BigInt(i + 1));
    [balls[i], balls[j]] = [balls[j], balls[i]];
  }

  return balls;
}
```

**✅ Correcto:** Fisher-Yates shuffle con LCG es un patrón estándar para shuffles determinísticos.

**⚠️ Nota:** El LCG usa multiplicador y incremento de Knuth (PCG-compatible). Matemáticamente válido pero el período es 2^64 — suficiente para 75 bolas pero no criptográficamente seguro. Para un juego de azar debería usarse un CSPRNG.

**✅ Consistencia:** El mismo algoritmo existe en frontend (`useBingoGame.js`) y backend (`bingoResolverService.js`), garantizando resultados idénticos dado el mismo seed.

---

## Resumen de Issues

| Severidad | Cantidad | Items Principales |
|-----------|----------|-------------------|
| 🔴 Bug real | 1 | Pagos fuera de transacción DB |
| 🔴 Anti-patrón React | 1 | setState dentro de updater |
| 🟡 Potencial bug | 4 | Race condition compras, lógica balance, stale refs, constants desync |
| 🟢 Mejora menor | 3 | Tests faltantes, código duplicado, N+1 queries |
