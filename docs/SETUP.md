# Configuración

## Requisitos

- Node.js 22.13 o posterior y npm 10 o posterior.
- Un proyecto independiente de Google Apps Script.
- Un spreadsheet privado y vacío o con hojas JobOps compatibles.
- Acceso a la cuenta de Gmail donde se crearán las etiquetas.

## Preparación local

1. Ejecuta `npm ci` desde la raíz del repositorio.
2. Ejecuta `npm run ci`.
3. Copia `.clasp.json.example` como `.clasp.json`.
4. Sustituye el placeholder por el Script ID privado.
5. Ejecuta `npx clasp show-file-status` y confirma que solo aparecen `appsscript.json` y `src/*.js`.
6. Autoriza `clasp` y ejecuta `npm run push` manualmente.

Los archivos se mantienen como `.js` localmente. Apps Script los recibe como código de servidor; no es necesario renombrarlos a `.gs`.

## Script Properties obligatorias

En **Project Settings → Script Properties** agrega:

| Key              | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| `SPREADSHEET_ID` | ID del spreadsheet privado, no su URL completa.          |
| `USER_EMAIL`     | Correo que recibirá los resúmenes en una fase posterior. |

Nunca confirmes `.clasp.json`, credenciales, IDs privados, correos reales, CV ni fixtures sin anonimizar.

## Inicialización

1. Ejecuta `setupJobOps()` desde el editor de Apps Script.
2. Autoriza los permisos de Google Sheets y Gmail solicitados.
3. Comprueba que existan las siete hojas y las cuatro etiquetas `Jobs/*`.
4. Ejecuta `validateJobOpsConfiguration()`; debe devolver `valid: true`.
5. Después de desplegar la Fase 2, ejecuta `dryRunIngestion()` y revisa los contadores.
6. Ejecuta `ingestJobs()` solo después de validar ese resultado.

La primera ejecución inserta encabezados y filas iniciales. Las siguientes ejecuciones agregan únicamente elementos faltantes; no reemplazan claves de configuración, notas ni otros valores existentes. Un encabezado incompatible produce `CONFIGURATION_ERROR` antes de sobrescribirlo.

`USER_EMAIL` puede ser una dirección Hotmail/Outlook: se reserva para el digest posterior. La ingestión siempre lee el buzón de la cuenta de Google que autoriza el script. Puedes reenviar a ese Gmail los mensajes recibidos en Hotmail; el parser intenta recuperar el remitente y asunto originales.

## Permisos de las Fases 1 y 2

El manifest declara únicamente:

- Google Sheets, para abrir y preparar el spreadsheet configurado.
- Gmail, para buscar y leer mensajes candidatos y administrar etiquetas `Jobs/*`.

JobOps no envía correo ni instala triggers en esta fase. El manifest solicita acceso completo a Gmail porque `GmailApp` no ofrece un scope más estrecho compatible con lectura, búsqueda y etiquetas.
