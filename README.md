# JobOps

[![CI](https://github.com/Pizofh/JobOps/actions/workflows/ci.yml/badge.svg)](https://github.com/Pizofh/JobOps/actions/workflows/ci.yml)

**Organización de oportunidades laborales con JavaScript nativo para Google Apps Script.**

JobOps es un proyecto de automatización personal que organiza oportunidades y su seguimiento en Google Sheets. Este repositorio presenta el código y la documentación técnica; cada instalación utiliza su propia configuración.

## Qué demuestra

- Separación entre lógica de dominio y servicios externos.
- Normalización de datos y deduplicación.
- Reglas configurables para clasificación y priorización.
- Protección de campos administrados por el usuario.
- Pruebas con el runner nativo de Node.js.
- Validación de lint, formato y manifest en GitHub Actions.
- Despliegue manual con clasp.

## Decisiones de ingeniería

El proyecto utiliza JavaScript nativo compatible con Apps Script V8. La lógica de dominio puede probarse localmente; las integraciones se mantienen separadas para facilitar el mantenimiento.

La configuración se realiza por instancia y el despliegue es manual. Los comandos de validación local comprueban el código sin desplegarlo.

## Inicio rápido

Requisitos: Git, Node.js 22.13 o posterior y npm 10 o posterior.

```bash
git clone https://github.com/Pizofh/JobOps.git
cd JobOps
npm ci
npm run ci
```

En PowerShell, si la política de ejecución bloquea `npm.ps1`, usa `npm.cmd` en lugar de `npm`.

Para conectar una instancia de Apps Script, consulta la guía de configuración.

## Validación local

- `npm run lint`: valida JavaScript.
- `npm run format:check`: comprueba el formato.
- `npm test`: ejecuta pruebas con `node:test`.
- `npm run validate:manifest`: valida el manifest.
- `npm run ci`: ejecuta todas las validaciones.
- `npm run push`: despliega manualmente una instancia configurada.

## Documentación

- [Configuración de una instancia](docs/SETUP.md)
- [Operación](docs/OPERATIONS.md)
- [Pruebas](docs/TESTING.md)
- [Plan de producto](docs/PRD.md)

## Estructura

- `src/`: lógica de dominio e integraciones.
- `tests/`: pruebas locales y fixtures.
- `scripts/`: validaciones auxiliares.
- `.github/workflows/ci.yml`: validación automática.
- `appsscript.json`: manifest de Apps Script.

## Alcance

Es una herramienta para apoyar la revisión y el seguimiento manual de oportunidades. La configuración privada pertenece a cada instalación.
