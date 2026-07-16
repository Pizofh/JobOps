# Operación

## Funciones disponibles

- `setupJobOps()`: crea o completa de forma no destructiva hojas, encabezados, configuración inicial, validaciones, formato y etiquetas.
- `validateJobOpsConfiguration()`: valida Script Properties, estructura de hojas y valores de `Config` sin exponer IDs privados.
- `dryRunIngestion()`: busca, detecta, normaliza y deduplica candidatos sin modificar Gmail ni Sheets.
- `ingestJobs()`: ejecuta la ingestión real; también funciona como dry run cuando `Config.DRY_RUN` es `true`.

Los entrypoints de triggers, digest, scoring y estados siguen inertes hasta su fase correspondiente.

## Ejecución segura

1. Ejecuta `validateJobOpsConfiguration()` después de editar `Config`.
2. Ejecuta primero `dryRunIngestion()` y revisa sus contadores en el resultado y en el registro de ejecución.
3. Si el resultado es razonable, ejecuta `ingestJobs()` manualmente.
4. Revisa las filas nuevas de `Jobs`, los diagnósticos de `ParsingErrors` y las etiquetas `Jobs/*`.
5. Si falta una fila inicial, vuelve a ejecutar `setupJobOps()`; solo se agregará la clave faltante.
6. Si aparece `CONFIGURATION_ERROR` por un encabezado incompatible, corrige manualmente el encabezado. El setup no lo reemplazará.
7. Revisa `npx clasp show-file-status` antes de cada despliegue manual.

## Valores iniciales editables

`DIGEST_HOUR` comienza en `8` y `RECRUITER_SCORE_BONUS` en `5`. Son decisiones iniciales, no valores permanentes: pueden cambiarse en `Config` sin modificar JavaScript.

## Comportamiento de la ingestión

- Busca hasta `MAX_MESSAGES_PER_RUN` candidatos dentro de `LOOKBACK_DAYS`.
- Reconoce remitentes configurados en `Sources` y oportunidades de reclutadores solo con señales positivas y técnicas.
- Lee encabezados originales `From/De` y `Subject/Asunto` en mensajes reenviados, por lo que el correo profesional puede ser Hotmail/Outlook y Gmail puede quedar como buzón técnico.
- Elimina parámetros de rastreo conocidos de las URLs y deduplica solo por identificadores exactos: Gmail Message ID, URL canónica o combinación de fuente e ID de vacante.
- Cuando una misma URL llega desde otra fuente, conserva la fila inicial, agrega la fuente a `ALL_SOURCES` y completa únicamente datos del sistema que estuvieran vacíos o fueran desconocidos. Nunca reemplaza `STATUS`, fechas manuales ni `NOTES`.
- Escribe nuevas filas y errores por lotes. Un parser fallido no detiene los demás mensajes.
- No guarda el cuerpo completo del correo ni lo escribe en los logs.

Las etiquetas de `GmailApp` se aplican por hilo, no por mensaje individual. Un hilo con cualquier error queda en `Jobs/Failed`; un hilo correcto queda en `Jobs/Processed`, y las oportunidades de reclutador reciben además `Jobs/Recruiters`.

No existen todavía triggers, digest, seguimiento automático, scoring completo ni aplicaciones automáticas.
