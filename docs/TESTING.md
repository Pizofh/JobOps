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
4. Validación estricta de `appsscript.json`.

## Prueba de humo de la Fase 0

La prueba carga `src/14_Entrypoints.js` en un contexto aislado, verifica los ocho nombres globales y confirma que llamarlos no devuelve valores ni requiere servicios de Google.

Las futuras integraciones no intentarán probar el funcionamiento interno de GmailApp, SpreadsheetApp o MailApp localmente. La lógica pura deberá probarse sin Google y los adaptadores pequeños se verificarán de forma manual y controlada.
