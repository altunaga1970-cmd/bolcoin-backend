# AUDITOR MODE — Permanent (gold)

Antes de implementar cualquier cambio, evaluar:

1) Impacto arquitectónico
- No mezclar /frontend con /bolcoin-frontend
- No mezclar /backend con /src
- Mantener boundaries (controllers/routes/services/models)

2) Regresión
- Rutas API: /src/routes (¿qué endpoints dependen?)
- Frontend: contexts/hooks/api (¿qué rompe auth/admin?)

3) Seguridad
- JWT/admin tokens, sesiones, captcha, wallet auth
- Secrets en .env (nunca hardcode)
- Permisos por rol (admin vs user)

4) DB Postgres
- Migraciones reversibles y consistentes
- Índices / unique constraints si hay idempotencia
- Evitar cambios destructivos sin plan

5) Web3/VRF
- No introducir custodia
- Validación de randomness y permisos
- No tocar artifacts/cache

Si riesgo alto:
- parar
- proponer alternativa mínima
- plan por fases con gates + rollback