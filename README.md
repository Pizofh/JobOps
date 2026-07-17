# JobOps

JobOps es un sistema personal y privado para organizar una búsqueda de empleo desde Google Apps Script, Gmail y Google Sheets. El repositorio contiene la configuración inicial, la ingestión, la evaluación y la **Fase 5** de flujo de aplicaciones y resumen diario.

`setupJobOps()` crea de forma no destructiva las hojas, datos configurables, validaciones, formato y etiquetas de Gmail. `dryRunIngestion()` inspecciona mensajes recientes sin modificar Gmail ni Sheets y `ingestJobs()` guarda vacantes detectadas, errores limitados y etiquetas operativas. Todavía no instala triggers ni envía correos.

## Requisitos locales

- Node.js 22.13 o posterior.
- npm 10 o posterior.
- Git.
- Una cuenta de Google y un proyecto de Apps Script solo cuando se haga la conexión manual futura.

En PowerShell, si la política de ejecución bloquea `npm.ps1`, usa `npm.cmd` en lugar de `npm`.

## Inicio rápido

```bash
npm ci
npm run ci
```

## Comandos

| Comando                     | Propósito                                                              |
| --------------------------- | ---------------------------------------------------------------------- |
| `npm run lint`              | Valida JavaScript de `src`, `tests` y `scripts`.                       |
| `npm run format`            | Aplica Prettier a los archivos compatibles.                            |
| `npm run format:check`      | Comprueba formato sin modificar archivos.                              |
| `npm test`                  | Ejecuta las pruebas con `node:test`.                                   |
| `npm run validate:manifest` | Valida el manifest seguro de Apps Script.                              |
| `npm run ci`                | Ejecuta todas las validaciones locales.                                |
| `npm run push`              | Despliega manualmente con `clasp` cuando exista configuración privada. |
| `npm run open`              | Abre el proyecto configurado en Apps Script.                           |

## Configuración local de clasp

1. Copia `.clasp.json.example` como `.clasp.json`.
2. Sustituye el placeholder por el Script ID real.
3. Mantén `.clasp.json` fuera de Git; ya está ignorado.
4. Comprueba qué archivos se desplegarían con `npx clasp show-file-status`.

`.claspignore` limita el despliegue a `appsscript.json` y los archivos JavaScript directamente dentro de `src/`. El despliegue es siempre manual y GitHub Actions nunca ejecuta `clasp push`.

### Por qué los archivos locales usan `.js`

Apps Script representa el código de servidor como archivos de script y su editor suele mostrarlos como `.gs`. `clasp` admite `.js` localmente; `.clasp.json.example` fija `scriptExtensions: [".js"]`. Esto permite ejecutar las mismas fuentes con Node, ESLint y las pruebas sin compilación ni conversión manual.

## Documentación

- [Plan maestro y PRD](docs/PRD.md)
- [Configuración](docs/SETUP.md)
- [Operación](docs/OPERATIONS.md)
- [Pruebas](docs/TESTING.md)

## Estado

Fase completada: **Fase 5 — Flujo de aplicaciones y resumen**. Un trigger instalable completa fechas al cambiar a `APPLIED`; el resumen diario incluye oportunidades, reclutadores, seguimientos y errores sin cuerpos de correo. La instalación de triggers es manual mediante `installJobOpsTriggers()`.
