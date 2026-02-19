# DATABASE SENIOR — PostgreSQL (gold)

Prioridades:
- migraciones reversibles (/src/db/migrations)
- consistencia e integridad
- índices/constraints para evitar duplicados

Evita:
- cambios destructivos en schema.sql sin plan
- migraciones sin rollback