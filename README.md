# SafeMap RD (Full-Stack)

Aplicacion web para visualizar y reportar robos recientes en Republica Dominicana.

## Tecnologias
- Frontend: HTML + CSS + JavaScript + Leaflet
- Backend: Node.js (sin dependencias externas)
- Persistencia: archivos JSON en `data/`

## Funcionalidades
- Mapa interactivo de incidentes por tipo.
- Reporte comunitario de robos recientes.
- Filtros por tipo y ventana temporal.
- Deteccion de zonas calientes por concentracion.
- Panel admin con autenticacion para moderar reportes (eliminar).

## Seguridad aplicada
- Validacion y saneo de entradas en backend.
- Restriccion de coordenadas para RD.
- Rechazo de fechas futuras o demasiado antiguas.
- Rate limiting por IP para login/reportes.
- Hash de contrasena con `scrypt`.
- Tokens firmados HMAC con expiracion.
- Cabeceras de seguridad y CSP.
- Escritura atomica para archivos de datos.

## Ejecutar
1. Abrir terminal en `C:\Users\user\OneDrive\Desktop\Security`
2. Ejecutar:

```bash
npm start
```

3. Abrir en navegador:
- [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Credenciales admin demo
- Usuario: `admin`
- Clave: `Cambia123!`

Puedes cambiarlas antes de arrancar:

```bash
set ADMIN_USER=tu_usuario
set ADMIN_PASSWORD=tu_clave_segura
set TOKEN_SECRET=una_clave_larga_y_unica
npm start
```

## Estructura
- `server.js`: API + seguridad + servidor estatico.
- `public/`: frontend.
- `data/incidents.json`: base de datos de incidentes.
- `data/users.json`: usuarios admin hash.

## Nota
Este sistema es para prevencion ciudadana y referencia. Para emergencias reales en RD, llamar al 911.
