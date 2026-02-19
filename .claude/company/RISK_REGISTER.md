# Risk Register - Bolcoin

| ID | Riesgo | Severidad | Mitigacion | Estado |
|----|--------|-----------|------------|--------|
| R1 | VRF off-chain (SHA-256) no es provably fair on-chain | HIGH | Chainlink VRF planificado (Phase 3) | ABIERTO |
| R2 | Settlement on-chain deshabilitado (ABI mismatch 3 vs 5 params) | HIGH | DB es source of truth; fix ABI pendiente | ABIERTO |
| R3 | Zero test coverage en backend | HIGH | Escribir tests para servicios criticos | ABIERTO |
| R4 | 23 archivos modificados sin commit | MEDIUM | Revisar y commitear cambios staged | ABIERTO |
| R5 | Loss limits parcialmente implementados (DB only, no UI) | MEDIUM | Completar UI + enforcement | ABIERTO |
| R6 | Dev routes exponen endpoints peligrosos | LOW | Solo activos en NODE_ENV=development | MITIGADO |
| R7 | Commit-reveal no implementado | MEDIUM | Phase 3 | ABIERTO |
