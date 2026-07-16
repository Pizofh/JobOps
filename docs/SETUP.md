# Configuración

## Alcance actual

La Fase 0 prepara el repositorio local. No autoriza ni ejecuta accesos a Gmail, Google Sheets, PropertiesService o MailApp.

## Preparación local

1. Instala Node.js 22.13 o posterior y npm 10 o posterior.
2. Ejecuta `npm ci` desde la raíz del repositorio.
3. Ejecuta `npm run ci`.

## Conexión manual futura con Apps Script

1. Copia `.clasp.json.example` como `.clasp.json`.
2. Reemplaza el placeholder con el Script ID privado.
3. Autoriza `clasp` manualmente cuando corresponda.
4. Revisa `npx clasp show-file-status` antes de cualquier `npm run push`.

No confirmes `.clasp.json`, credenciales, IDs privados, correos reales, CV ni fixtures sin anonimizar. El despliegue nunca se realiza desde CI.
