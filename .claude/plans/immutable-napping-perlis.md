# Plan: Footer en Keno + Actualizacion de Paginas Legales/Info

## Contexto

El proyecto ya tiene un Footer completo (`Footer.jsx`) y 7 paginas legales + 8 paginas info creadas. Sin embargo:
1. **KenoPage (pagina principal)** no muestra el Footer - renderiza su propio layout con `<MainNav />`
2. **Las paginas legales/info** no estan envueltas en ningun layout (sin Header/Footer) en App.js
3. **El contenido** referencia "La Bolita" en vez de "Bolcoin" y menciona "Chainlink VRF" cuando el sistema actual usa SHA-256 provably fair server-side
4. El Footer dice "Chainlink VRF" y "On-Chain Settlements" que aun no estan activos

---

## Fase 1: Agregar Footer a KenoPage

### 1.1 EDITAR `bolcoin-frontend/src/pages/user/KenoPage.jsx`
- Importar `Footer` de `../../components/layout/Footer`
- Agregar `<Footer />` al final del JSX, antes del cierre de `<div className="keno-page">`

---

## Fase 2: Envolver paginas legales/info en PublicLayout

### 2.1 EDITAR `bolcoin-frontend/src/App.js`

Agrupar las rutas de info y legal dentro de un `<Route element={<PublicLayout />}>` para que tengan Header + Footer automaticamente.

```jsx
import PublicLayout from './components/layout/PublicLayout';

// En Routes:
{/* Paginas publicas con layout (Header + Footer) */}
<Route element={<PublicLayout />}>
  <Route path="/how-it-works" element={<HowItWorksPage />} />
  <Route path="/transparency" element={<TransparencyPage />} />
  <Route path="/fairness" element={<FairnessPage />} />
  <Route path="/statistics" element={<StatisticsPage />} />
  <Route path="/faq" element={<FAQPage />} />
  <Route path="/contact" element={<ContactPage />} />
  <Route path="/official-links" element={<OfficialLinksPage />} />
  <Route path="/results" element={<ResultsPage />} />

  {/* Legales */}
  <Route path="/legal/terms" element={<TermsPage />} />
  <Route path="/legal/rules" element={<RulesPage />} />
  <Route path="/legal/privacy" element={<PrivacyPage />} />
  <Route path="/legal/cookies" element={<CookiesPage />} />
  <Route path="/legal/responsible-gaming" element={<ResponsibleGamingPage />} />
  <Route path="/legal/jurisdictions" element={<JurisdictionsPage />} />
  <Route path="/legal/disclaimer" element={<DisclaimerPage />} />
</Route>
```

---

## Fase 3: Actualizar Footer.jsx

### 3.1 EDITAR `bolcoin-frontend/src/components/layout/Footer.jsx`

Cambios:
- Trust indicator "Chainlink VRF" → "Provably Fair (SHA-256)" (estado real)
- Trust indicator "On-Chain Settlements" → "Polygon Network" (settlement on-chain pendiente)
- Tagline: actualizar a "Bolcoin" (ya no "La Bolita")
- Links de juegos: marcar La Bolita y La Fortuna como "Proximamente"

---

## Fase 4: Actualizar contenido de paginas legales

### 4.1 EDITAR `bolcoin-frontend/src/pages/legal/PrivacyPage.jsx`
- Cambiar todas las referencias "La Bolita" → "Bolcoin"
- Actualizar fecha "Last updated: February 10, 2026"
- Seccion 2.1: aclarar que Keno usa sesiones virtuales (no todas las jugadas van on-chain, solo settlements)
- Seccion 2.2: mencionar que se almacena wallet signature (day-based) en localStorage
- Seccion 2.3: enfatizar que es no-custodial, sin KYC, sin email obligatorio

### 4.2 EDITAR `bolcoin-frontend/src/pages/legal/TermsPage.jsx`
- Cambiar "La Bolita" → "Bolcoin" en todo el archivo
- Actualizar fecha
- Agregar seccion sobre Keno: apuesta fija 1 USDT, cap dinamico del pool, sesiones virtuales
- Actualizar seccion de fairness: SHA-256 provably fair (no Chainlink VRF aun)
- Seccion no-custodial: usuario controla su wallet, plataforma no tiene acceso a fondos

### 4.3 EDITAR `bolcoin-frontend/src/pages/legal/ResponsibleGamingPage.jsx`
- Cambiar "La Bolita" → "Bolcoin"
- Actualizar fecha
- Agregar info especifica de Keno: rate limit (10 jugadas/min), apuesta fija baja ($1), cap de payout
- Mencionar que no hay loss limits automaticos (Fase 3 pendiente)

### 4.4 EDITAR `bolcoin-frontend/src/pages/public/FairnessPage.jsx`
- Cambiar "La Bolita" → "Bolcoin"
- Actualizar "Chainlink VRF" → explicar sistema actual:
  - SHA-256 provably fair con server seed + client seed + nonce
  - Cada juego tiene un gameId verificable en /api/keno/verify/:gameId
  - Roadmap: migracion a Chainlink VRF on-chain (Fase 3)
- Agregar seccion "Como Verificar" con ejemplo del endpoint de verificacion

---

## Archivos a modificar (orden)

| # | Archivo | Accion |
|---|---------|--------|
| 1 | `bolcoin-frontend/src/pages/user/KenoPage.jsx` | Agregar import Footer + render |
| 2 | `bolcoin-frontend/src/App.js` | Envolver rutas info/legal en PublicLayout |
| 3 | `bolcoin-frontend/src/components/layout/Footer.jsx` | Actualizar trust indicators + branding |
| 4 | `bolcoin-frontend/src/pages/legal/PrivacyPage.jsx` | Reescribir para Bolcoin/Keno/no-custodial |
| 5 | `bolcoin-frontend/src/pages/legal/TermsPage.jsx` | Reescribir para Bolcoin/Keno |
| 6 | `bolcoin-frontend/src/pages/legal/ResponsibleGamingPage.jsx` | Actualizar para Keno |
| 7 | `bolcoin-frontend/src/pages/public/FairnessPage.jsx` | SHA-256 provably fair (no Chainlink VRF) |

---

## Verificacion

1. Navegar a `/` (KenoPage) → Footer visible al final de la pagina
2. Navegar a `/legal/privacy` → Header + contenido + Footer visibles
3. Navegar a `/legal/terms` → Header + contenido + Footer
4. Navegar a `/legal/responsible-gaming` → Header + contenido + Footer
5. Navegar a `/fairness` → Header + contenido actualizado SHA-256 + Footer
6. Links del Footer funcionan correctamente (privacy, terms, etc.)
7. No se rompe ningun otro layout (admin, wallet, etc.)
