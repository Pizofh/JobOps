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

## Cobertura de la Fase 1

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

Los dobles no intentan reproducir el funcionamiento interno de Google. Comprueban únicamente las decisiones y llamadas de JobOps. La integración real debe verificarse manualmente en un spreadsheet de prueba controlado.
