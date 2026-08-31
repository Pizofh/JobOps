# JobOps

JobOps es un sistema personal y privado para organizar una búsqueda de empleo desde Google Apps Script, Gmail y Google Sheets. Incluye un centro de operación web privado para revisar y gestionar únicamente oportunidades HIGH, REVIEW y OPTIONAL. El repositorio contiene la configuración inicial, la ingestión, la evaluación y la **Fase 5** de flujo de aplicaciones y resumen diario.

`setupJobOps()` crea de forma no destructiva las hojas, datos configurables, validaciones, formato y etiquetas de Gmail. `dryRunIngestion()` inspecciona mensajes recientes sin modificar Gmail ni Sheets y `ingestJobs()` guarda vacantes detectadas, errores limitados y etiquetas operativas. Los triggers y el resumen existen, pero solo se activan manualmente con `installJobOpsTriggers()` después de validar el dry run.

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

## IA opcional para alertas con varias vacantes

JobOps usa una cadena de proveedores únicamente para extraer alertas multi-vacante de LinkedIn/Indeed y asignar una familia semántica. El scoring, la deduplicación y la escritura en Sheets siguen siendo lógica local. La IA también puede extraer seniority y años de experiencia explícitos; JobOps convierte esa evidencia en un ajuste determinístico de fit, sin permitir que el modelo invente o asigne el score.

Orden de fallback: **Gemini → Groq → OpenRouter**. Los errores transitorios 429/5xx se reintentan de forma acotada antes de pasar al siguiente proveedor.

Script Properties opcionales:

- `GEMINI_API_KEY` / `GEMINI_MODEL`
- `GROQ_API_KEY` / `GROQ_MODEL` (default: `openai/gpt-oss-20b`)
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` (default: `openrouter/free`)

Solo necesitas una API key para habilitar IA; con varias configuradas se activa el fallback. Las claves nunca deben guardarse en Git. JobOps redacciona direcciones y URLs personalizadas antes de enviar evidencia, usa referencias opacas para enlaces y valida localmente cada vacante devuelta.

Para validar la integración, conserva `DRY_RUN = true`, despliega manualmente con `clasp` y ejecuta `dryRunIngestion()`.

## Centro de operación web

La Web App de Apps Script expone únicamente vacantes `HIGH`, `REVIEW` y `OPTIONAL`; las `LOW` se filtran en el servidor. Permite buscar, filtrar, abrir la vacante y el CV recomendado, cambiar estado, guardar notas y lanzar una ingesta manual.

El despliegue sigue siendo manual desde Apps Script. Configúrala para ejecutarse como el propietario y con acceso restringido al propio usuario; JobOps no requiere un servidor adicional ni una base de datos externa.

## Documentación

- [Plan maestro y PRD](docs/PRD.md)
- [Configuración](docs/SETUP.md)
- [Operación](docs/OPERATIONS.md)
- [Pruebas](docs/TESTING.md)

## Estado

Fase completada: **Fase 5 — Flujo de aplicaciones y resumen**. Un trigger instalable completa fechas al cambiar a `APPLIED`; el resumen diario incluye oportunidades, reclutadores, seguimientos y errores sin cuerpos de correo. La instalación de triggers es manual mediante `installJobOpsTriggers()`.
