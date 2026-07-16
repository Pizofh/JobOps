# Operación

## Funciones disponibles

- `setupJobOps()`: crea o completa de forma no destructiva hojas, encabezados, configuración inicial, validaciones, formato y etiquetas.
- `validateJobOpsConfiguration()`: valida Script Properties, estructura de hojas y valores de `Config` sin exponer IDs privados.

Los demás entrypoints siguen inertes hasta su fase correspondiente.

## Ejecución segura

1. Ejecuta `validateJobOpsConfiguration()` después de editar `Config`.
2. Si falta una fila inicial, vuelve a ejecutar `setupJobOps()`; solo se agregará la clave faltante.
3. Si aparece `CONFIGURATION_ERROR` por un encabezado incompatible, corrige manualmente el encabezado. El setup no lo reemplazará.
4. Revisa `npx clasp show-file-status` antes de cada despliegue manual.

## Valores iniciales editables

`DIGEST_HOUR` comienza en `8` y `RECRUITER_SCORE_BONUS` en `5`. Son decisiones iniciales, no valores permanentes: pueden cambiarse en `Config` sin modificar JavaScript.

No existen todavía ingestión, triggers, digest, seguimiento automático ni acceso al contenido de Gmail.
