# Bolcoin - Lessons Learned

## 2026-02-05

### Problema: Variables de entorno no se leen en produccion
**Causa**: El archivo `.env.production` usaba prefijos `REACT_APP_*` (Create React App) pero el proyecto usa Vite.
**Solucion**: Cambiar todos los prefijos a `VITE_*`.
**Leccion**: Vite SOLO expone variables que empiezan con `VITE_`. Verificar siempre el bundler usado.

### Problema: WalletConnect no funciona en movil
**Causa**: `VITE_WALLETCONNECT_PROJECT_ID` estaba vacio en `.env` y `.env.production`.
**Solucion**: Agregar el project ID existente (7396b28442dee2e69b50fe5285a0953d).
**Leccion**: WalletConnect v2 REQUIERE un projectId valido. Obtener en https://cloud.walletconnect.com/

### Problema: Dos carpetas frontend
**Observacion**: Existen `frontend/` y `bolcoin-frontend/`.
**Realidad**: `frontend/` es el activo con todo el codigo Keno. `bolcoin-frontend/` parece version anterior/alternativa.
**Leccion**: Siempre verificar cual es el directorio activo antes de hacer cambios.

### Configuracion correcta para Vite + Cloudflare Pages
```
Build command: npm run build
Output directory: dist
Root directory: frontend (si el repo tiene multiples carpetas)
```

Variables de entorno en Cloudflare Dashboard sobreescriben las del repo.
