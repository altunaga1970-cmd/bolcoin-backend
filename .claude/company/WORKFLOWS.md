# Workflows - Bolcoin

## Workflow de Cambio
1. PROJECT_BOOT (leer estado)
2. Auto-Router (activar agentes minimos)
3. Scope Guard (validar que no rompe contrato)
4. Plan por fases + gates
5. Senior Review si aplica (auth/pagos/crypto/DB)
6. Implementar fase por fase
7. Verificar (build/test/flujo)
8. Documentar (PROJECT_STATE + CHANGELOG)

## Gates
- Gate A: Diagnostico (reproduce/compila)
- Gate B: Implementacion (build OK, no regresiones)
- Gate C: Verificacion (flujo principal funciona)
- Gate D: Documentacion (artefactos actualizados)

## Rollback
- Git revert del commit
- Si migracion DB: script de rollback explicito
- Si contrato: no hay rollback (proxy pattern o nuevo deploy)
