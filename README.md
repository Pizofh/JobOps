# JobOps

JobOps es un sistema personal y privado para organizar una búsqueda de empleo desde Google Apps Script, Gmail y Google Sheets. Este repositorio contiene únicamente la **Fase 0**: estructura, herramientas de calidad, manifest seguro y entrypoints globales inertes.

Todavía no hay acceso real a Gmail, Sheets, PropertiesService ni MailApp. Ningún entrypoint modifica datos o envía mensajes.

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

## Documentación

- [Plan maestro y PRD](docs/PRD.md)
- [Configuración](docs/SETUP.md)
- [Operación](docs/OPERATIONS.md)
- [Pruebas](docs/TESTING.md)

## Estado

Fase activa: **Fase 0 — Repositorio y reglas de trabajo**. Las fases funcionales posteriores no forman parte de este cambio.
