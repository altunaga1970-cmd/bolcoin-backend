# CHECKLIST - Bolcoin dApp

## Seguridad (Post-Auditoria)
- [x] Phase 0: 7 blockers criticos (wallet sig, hardcoded key, balance init, FOR UPDATE, SQL injection)
- [x] Phase 1: CHECK constraints, rate limiting, unique sessions, pool guard
- [x] Phase 2: UX (confirmacion, doble-click, wrong chain, error panel)
- [ ] Phase 3: VRF on-chain (Chainlink)
- [ ] Phase 3: Commit-reveal fairness
- [ ] Phase 3: Settlement on-chain (ABI fix)
- [ ] Phase 3: Loss limits UI

## Testing
- [ ] Backend: tests unitarios servicios criticos
- [ ] Backend: tests de integracion API
- [ ] Frontend: tests de componentes (solo 3 existentes)
- [ ] Contracts: tests Hardhat

## Juegos
- [x] Keno: MVP completo y en produccion
- [ ] La Bolita: backend ready, frontend/contracts pendiente
- [ ] La Fortuna: backend ready, frontend/contracts pendiente

## Infra
- [x] Backend deployado en Railway
- [x] Frontend deployado en Cloudflare Pages
- [x] DB PostgreSQL en Railway
- [ ] Monitoring/APM (Sentry, Datadog)
- [ ] CI/CD pipeline
