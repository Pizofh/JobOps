# Operación

## Actualización de estrategia

Después de desplegar este ajuste, ejecuta `setupJobOps()` una vez. Añade las
columnas `GROUP` y `STRATEGIC_LEVEL`, crea las familias y reglas nuevas, y solo
migra filas iniciales que no fueron personalizadas. Luego ejecuta
`rescoreJobs()` manualmente para actualizar familia, score, prioridad, CV,
coincidencias y riesgos sin modificar estado, fechas ni notas.

La estrategia inicial combina cargos directos DevOps/Platform/SRE de entrada
con roles puente de soporte cloud y de aplicaciones, release, Linux e backend
con operación. Puedes ajustar todo desde las hojas sin otro despliegue.

## Funciones disponibles

- `setupJobOps()`: crea o completa de forma no destructiva hojas, encabezados, configuración inicial, validaciones, formato y etiquetas.
- `validateJobOpsConfiguration()`: valida Script Properties, estructura de hojas y valores de `Config` sin exponer IDs privados.
- `dryRunIngestion()`: busca, detecta, normaliza y deduplica candidatos sin modificar Gmail ni Sheets.
- `ingestJobs()`: ejecuta la ingestión real; también funciona como dry run cuando `Config.DRY_RUN` es `true`.
- `rescoreJobs()`: recalcula familia, score, prioridad y CV para las filas existentes sin cambiar estado, fechas ni notas.
- `installJobOpsTriggers()`: instala una ejecución horaria de ingesta, un resumen diario y el trigger de edición; no crea duplicados.
- `sendDailyDigest()`: envía manualmente el resumen si hay contenido y aún no se envió ese día.

Los triggers se instalan únicamente al ejecutar `installJobOpsTriggers()`; no se crean durante `setupJobOps()` ni mediante CI.

## Ejecución segura

1. Ejecuta `validateJobOpsConfiguration()` después de editar `Config`.
2. Ejecuta primero `dryRunIngestion()` y revisa sus contadores en el resultado y en el registro de ejecución.
3. Si el resultado es razonable, ejecuta `ingestJobs()` manualmente.
4. Revisa las filas nuevas de `Jobs`, los diagnósticos de `ParsingErrors` y las etiquetas `Jobs/*`.
5. Si falta una fila inicial, vuelve a ejecutar `setupJobOps()`; solo se agregará la clave faltante.
6. Si aparece `CONFIGURATION_ERROR` por un encabezado incompatible, corrige manualmente el encabezado. El setup no lo reemplazará.
7. Revisa `npx clasp show-file-status` antes de cada despliegue manual.
8. Tras ajustar estrategia, ejecuta `rescoreJobs()` y revisa `ROLE_FAMILY`, `MATCH_SCORE`, `PRIORITY`, `RECOMMENDED_CV`, `STRONG_MATCHES` y `RISK_FLAGS`.
9. Prueba `sendDailyDigest()` manualmente una vez que existan filas relevantes; no enviará un correo vacío.

## Valores iniciales editables

`DIGEST_HOUR` comienza en `8` y `RECRUITER_SCORE_BONUS` en `5`. Son decisiones iniciales, no valores permanentes: pueden cambiarse en `Config` sin modificar JavaScript.

## Ajustar la estrategia profesional

No necesitas decidir todavía entre DevOps/SRE y roles técnicos más accesibles. Ajusta las filas habilitadas de `RoleFamilies` y `ScoringRules` para reflejar cada enfoque, y ejecuta `rescoreJobs()` para actualizar las vacantes existentes. Por ejemplo, puedes conservar la regla negativa de `Senior`, reducir su penalización o ampliar los patrones de `OTHER_TECHNICAL`; los cambios se aplican desde la hoja y no requieren un nuevo despliegue.

## Comportamiento de la ingestión

- Busca hasta `MAX_MESSAGES_PER_RUN` candidatos dentro de `LOOKBACK_DAYS`.
- Reconoce remitentes configurados en `Sources` y oportunidades de reclutadores solo con señales positivas y técnicas.
- Lee encabezados originales `From/De` y `Subject/Asunto` en mensajes reenviados, por lo que el correo profesional puede ser Hotmail/Outlook y Gmail puede quedar como buzón técnico.
- Elimina parámetros de rastreo conocidos de las URLs y deduplica solo por identificadores exactos: Gmail Message ID, URL canónica o combinación de fuente e ID de vacante.
- Cuando una misma URL llega desde otra fuente, conserva la fila inicial, agrega la fuente a `ALL_SOURCES` y completa únicamente datos del sistema que estuvieran vacíos o fueran desconocidos. Nunca reemplaza `STATUS`, fechas manuales ni `NOTES`.
- Escribe nuevas filas y errores por lotes. Un parser fallido no detiene los demás mensajes.
- No guarda el cuerpo completo del correo ni lo escribe en los logs.

Las etiquetas de `GmailApp` se aplican por hilo, no por mensaje individual. Un hilo con cualquier error queda en `Jobs/Failed`; un hilo correcto queda en `Jobs/Processed`, y las oportunidades de reclutador reciben además `Jobs/Recruiters`.

Las mejoras de endurecimiento, fixtures adicionales y revisión de permisos quedan para la Fase 6. JobOps no automatiza aplicaciones laborales.
Al cambiar una fila a `APPLIED`, JobOps completa solo las fechas vacías de aplicación y seguimiento. Nunca envía una aplicación ni un mensaje de seguimiento.
