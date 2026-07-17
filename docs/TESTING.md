# Pruebas

JobOps usa el runner nativo `node:test` y no requiere Jest ni Vitest.

## Validación completa

```bash
npm run ci
```

La validación ejecuta, en orden:

1. ESLint sobre `src`, `tests` y `scripts`.
2. Comprobación de formato con Prettier.
3. Pruebas de Node.
4. Validación estricta de `appsscript.json` y sus scopes permitidos.

## Cobertura de las Fases 1, 2, 3, 4 y 5

Las pruebas verifican:

- Carga de scripts clásicos sin efectos laterales al cargar archivos.
- Ocho entrypoints globales.
- Tipado y validación de `Config`.
- Validación de Script Properties y estados.
- Integridad de los esquemas y datos iniciales.
- Rechazo de encabezados incompatibles.
- Selección idempotente de filas iniciales.
- Creación idempotente de etiquetas.
- Rechazo temprano antes de acceder a Google cuando faltan propiedades.
- Dos ejecuciones completas de `setupJobOps()` con dobles locales, preservando una edición manual.
- Normalización de HTML, espacios, tecnologías, modalidad y URLs canónicas.
- Deduplicación exacta por Message ID, URL canónica o fuente e ID de vacante, sin fusiones difusas por empresa o cargo.
- Unión de una segunda fuente en `ALL_SOURCES`, preservando estado, fechas y notas manuales.
- Parser específico de LinkedIn y selección segura del parser de Indeed.
- Parser genérico para una fuente configurada o fuente sin fixture específico.
- Clasificación por patrones editables de `RoleFamilies`.
- Score explicable con reglas positivas, negativas, de requerimiento y bono de reclutador.
- Recomendación de CV desde `CVProfiles`.
- `rescoreJobs()` que solo actualiza campos de evaluación y conserva los campos manuales.
- Cálculo de fechas de aplicación y seguimiento usando días hábiles, sin sobrescribir fechas existentes.
- Selección y renderizado de secciones del resumen diario sin incluir cuerpos de correos.
- Parser de reclutador con encabezados originales de un reenvío tipo Hotmail/Outlook.
- Error estable para una alerta candidata sin datos mínimos.
- Dry run sin cambios en Sheets ni etiquetas.
- Ingestión por lote con una vacante duplicada, una falla aislada y bono de reclutador.
- Segunda ejecución sin duplicar filas ya procesadas.

Los fixtures son sintéticos y usan dominios reservados. Los dobles no intentan reproducir el funcionamiento interno de Google; comprueban únicamente las decisiones y llamadas de JobOps. La integración real debe verificarse manualmente en un spreadsheet de prueba controlado, empezando por `dryRunIngestion()`.
