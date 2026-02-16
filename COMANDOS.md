# 📝 Guía de Comandos - La Bolita

## 🎯 Método Rápido (Windows)

### Usar el menú interactivo
```cmd
cd backend
setup.bat
```

Esto abrirá un menú con todas las opciones disponibles.

---

## 📋 Comandos Individuales

### 1. Verificar PostgreSQL
```cmd
cd backend
node scripts/check-postgres.js
```

**¿Qué hace?**
- Verifica si PostgreSQL está instalado
- Prueba la conexión a la base de datos
- Muestra las tablas existentes
- Cuenta los registros

---

### 2. Configurar Base de Datos
```cmd
cd backend
node scripts/setup-db.js
```

**¿Qué hace?**
- Lee el archivo schema.sql
- Elimina tablas existentes (si las hay)
- Crea todas las tablas desde cero
- Inserta configuraciones iniciales
- Muestra las tablas creadas

**⚠️ ADVERTENCIA:** Esto eliminará todos los datos existentes

---

### 3. Crear Usuario Admin
```cmd
cd backend
node scripts/create-admin.js
```

**¿Qué hace?**
- Crea el usuario `admin` con contraseña `admin123`
- Le asigna el rol de administrador
- Le da 1000 USDT de balance inicial
- Muestra las credenciales

**Credenciales creadas:**
- Username: `admin`
- Password: `admin123`
- Role: `admin`

---

### 4. Cargar Datos de Prueba
```cmd
cd backend
node scripts/seed-data.js
```

**¿Qué hace?**
- Crea 3 usuarios de prueba
- Crea 3 sorteos de ejemplo
- Crea apuestas de ejemplo
- Muestra resumen de datos

**Usuarios creados:**
- usuario1 (500 USDT)
- usuario2 (1000 USDT)
- usuario3 (2000 USDT)

Todos con contraseña: `password123`

---

### 5. Iniciar Servidor
```cmd
cd backend
npm run dev
```

**¿Qué hace?**
- Inicia el servidor Express en puerto 5000
- Conecta a PostgreSQL
- Muestra logs en tiempo real
- Recarga automáticamente en cambios (nodemon)

**Presiona Ctrl+C para detener**

---

### 6. Probar API Completo
```cmd
cd backend
node scripts/test-api.js
```

**¿Qué hace?**
- Ejecuta 13 pruebas automáticas
- Verifica todos los endpoints principales
- Prueba flujo completo de usuario
- Muestra resultados detallados

**Pruebas incluidas:**
1. Health check
2. Registro de usuario
3. Login
4. Obtener perfil
5. Recargar balance
6. Crear sorteo (admin)
7. Abrir sorteo
8. Apuesta Fijos
9. Apuesta Corrido
10. Ver mis apuestas
11. Ingresar resultados
12. Verificar ganancias
13. Estadísticas del sorteo

---

## 🔧 Comandos de npm

### Instalar dependencias
```cmd
cd backend
npm install
```

### Iniciar en desarrollo (con auto-reload)
```cmd
npm run dev
```

### Iniciar en producción
```cmd
npm start
```

### Ejecutar tests
```cmd
npm test
```

---

## 🗄️ Comandos de PostgreSQL

### Conectar a PostgreSQL
```cmd
psql -U postgres
```

### Crear base de datos
```sql
CREATE DATABASE labolita;
```

### Listar bases de datos
```sql
\l
```

### Conectar a una base de datos
```sql
\c labolita
```

### Listar tablas
```sql
\dt
```

### Ver estructura de una tabla
```sql
\d users
```

### Ejecutar query
```sql
SELECT * FROM users;
```

### Salir de psql
```sql
\q
```

### Ejecutar schema desde archivo
```cmd
psql -U postgres -d labolita -f backend/src/db/schema.sql
```

---

## 🧪 Comandos de Prueba con curl

### Health check
```cmd
curl http://localhost:5000/health
```

### Registro
```cmd
curl -X POST http://localhost:5000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"testuser\",\"email\":\"test@test.com\",\"password\":\"password123\"}"
```

### Login
```cmd
curl -X POST http://localhost:5000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin\",\"password\":\"admin123\"}"
```

### Ver perfil (necesita token)
```cmd
curl http://localhost:5000/api/auth/me ^
  -H "Authorization: Bearer TU_TOKEN_AQUI"
```

### Recargar balance
```cmd
curl -X POST http://localhost:5000/api/wallet/recharge ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TU_TOKEN_AQUI" ^
  -d "{\"amount\":100}"
```

---

## 🐛 Comandos de Depuración

### Ver logs de PostgreSQL (Windows)
```cmd
cd "C:\Program Files\PostgreSQL\15\data\log"
dir /o-d
notepad postgresql-FECHA.log
```

### Ver logs de PostgreSQL (Docker)
```cmd
docker logs labolita-postgres
```

### Reiniciar PostgreSQL (Windows)
1. Abrir "Services"
2. Buscar "PostgreSQL"
3. Clic derecho > Restart

### Reiniciar PostgreSQL (Docker)
```cmd
docker restart labolita-postgres
```

### Ver procesos usando el puerto 5000
```cmd
netstat -ano | findstr :5000
```

### Matar proceso por PID
```cmd
taskkill /PID 12345 /F
```

---

## 📊 Queries Útiles de SQL

### Ver todos los usuarios
```sql
SELECT id, username, email, role, balance FROM users;
```

### Ver sorteos activos
```sql
SELECT * FROM draws WHERE status IN ('scheduled', 'open') ORDER BY scheduled_time;
```

### Ver apuestas de un usuario
```sql
SELECT * FROM bets WHERE user_id = 1 ORDER BY created_at DESC;
```

### Ver transacciones de un usuario
```sql
SELECT * FROM transactions WHERE user_id = 1 ORDER BY created_at DESC LIMIT 10;
```

### Ver estadísticas de un sorteo
```sql
SELECT
    COUNT(*) as total_apuestas,
    SUM(amount) as total_apostado,
    COUNT(CASE WHEN status = 'won' THEN 1 END) as ganadores
FROM bets
WHERE draw_id = 1;
```

### Resetear contraseña de admin (en psql)
```sql
-- Contraseña: admin123 (hasheado)
UPDATE users
SET password_hash = '$2a$10$YourHashedPasswordHere'
WHERE username = 'admin';
```

---

## 🔄 Flujo Completo de Configuración

```cmd
# 1. Instalar dependencias
cd backend
npm install

# 2. Configurar .env (editar manualmente)
notepad .env

# 3. Verificar PostgreSQL
node scripts/check-postgres.js

# 4. Configurar base de datos
node scripts/setup-db.js

# 5. Crear usuario admin
node scripts/create-admin.js

# 6. (Opcional) Cargar datos de prueba
node scripts/seed-data.js

# 7. Iniciar servidor
npm run dev

# 8. (En otra terminal) Probar API
node scripts/test-api.js
```

---

## 🚀 Flujo de Desarrollo Diario

```cmd
# 1. Iniciar PostgreSQL (si no está corriendo)
# Windows: Services > PostgreSQL > Start
# Docker: docker start labolita-postgres

# 2. Iniciar servidor backend
cd backend
npm run dev

# 3. (En otra terminal) Trabajar en el código
# Los cambios se recargan automáticamente

# 4. Probar cambios
node scripts/test-api.js
```

---

## 📦 Comandos de Producción

### Build del frontend (cuando esté listo)
```cmd
cd frontend
npm run build
```

### Iniciar backend en producción
```cmd
cd backend
NODE_ENV=production npm start
```

### Backup de base de datos
```cmd
pg_dump -U postgres labolita > backup.sql
```

### Restaurar base de datos
```cmd
psql -U postgres labolita < backup.sql
```

---

## 🆘 Comandos de Emergencia

### Resetear completamente la base de datos
```cmd
cd backend

# Opción 1: Desde psql
psql -U postgres
DROP DATABASE labolita;
CREATE DATABASE labolita;
\q

# Opción 2: Con script
node scripts/setup-db.js
```

### Limpiar node_modules y reinstalar
```cmd
cd backend
rmdir /s /q node_modules
del package-lock.json
npm install
```

### Ver todos los procesos de Node.js
```cmd
tasklist | findstr node
```

### Matar todos los procesos de Node.js
```cmd
taskkill /f /im node.exe
```

---

**💡 Tip:** Guarda este archivo como referencia rápida de comandos.
