# JobOps — Plan maestro de producto e implementación

## 1. Instrucción principal para Codex

Debes implementar **JobOps**, un sistema privado y de un solo usuario para organizar la búsqueda de empleo de Brian Steve Garnica Sandoval.

El sistema debe:

- Leer alertas laborales y mensajes de reclutadores desde Gmail.
- Extraer información de las vacantes.
- Guardar las oportunidades en Google Sheets.
- Evitar duplicados exactos.
- Clasificar y puntuar cada vacante.
- Recomendar el CV más adecuado.
- Enviar un resumen diario.
- Llevar control de aplicaciones y seguimientos.

La solución debe construirse con **JavaScript nativo para Google Apps Script**.

### Restricciones técnicas obligatorias

- No usar TypeScript.
- No usar React, Vue, Angular ni frontend externo.
- No usar bases de datos externas.
- No usar servidores propios.
- No usar Terraform, Kubernetes ni contenedores.
- No usar bundlers como Webpack, Rollup o esbuild.
- No usar imports o exports incompatibles con Apps Script.
- No automatizar aplicaciones laborales.
- No hacer scraping de LinkedIn ni de otros portales.
- No desplegar automáticamente desde GitHub Actions.

La prioridad es:

1. Que funcione.
2. Que sea confiable.
3. Que sea entendible.
4. Que pueda probarse.
5. Que pueda ampliarse sin reescribir todo.
6. Que no se convierta en una plataforma empresarial para resolver el problema de una sola persona.

---

# 2. Resumen del producto

JobOps es un sistema personal para reducir el trabajo administrativo de buscar empleo.

Centraliza alertas laborales procedentes de:

- LinkedIn.
- Indeed.
- Get on Board.
- WeRemoto.
- We Work Remotely.
- ElEmpleo.
- Computrabajo.
- Correos enviados directamente por reclutadores.

El sistema procesa los mensajes recibidos en Gmail, obtiene los datos disponibles de la vacante, los normaliza, calcula una puntuación, recomienda un CV y guarda el resultado en Google Sheets.

El usuario revisa las oportunidades y presenta cada aplicación manualmente.

JobOps no debe:

- Pulsar botones de aplicación.
- Completar formularios.
- Responder preguntas de experiencia.
- Enviar automáticamente un CV.
- Inventar competencias.
- Enviar mensajes a reclutadores sin revisión.
- Entrar en cuentas de portales de empleo.

---

# 3. Objetivo del producto

Reducir el tiempo, la carga mental y la desorganización asociados con la búsqueda laboral.

El objetivo operativo es facilitar la revisión y gestión de aproximadamente diez aplicaciones de calidad por día, siempre que existan suficientes vacantes relevantes.

El objetivo profesional es apoyar la transición hacia mejores puestos relacionados con:

- DevOps.
- Platform Engineering.
- SRE.
- Cloud Operations.
- Release y CI/CD.
- Application Support L2/L3.
- Production Support.
- Backend con automatización o infraestructura.
- IAM o DevSecOps.
- Otros roles técnicos que se configuren posteriormente.

Conseguir empleo es el objetivo de negocio, pero no es una garantía técnica del software. JobOps puede reducir fricción; no puede obligar a Recursos Humanos a desarrollar criterio, lamentablemente.

---

# 4. Alcance del MVP

## 4.1 Incluido

- Procesamiento automático de correos de Gmail.
- Detección de plataformas configuradas.
- Detección conservadora de correos de reclutadores.
- Google Sheets como interfaz principal.
- Resumen diario enviado por correo.
- Extracción de información de vacantes.
- Normalización de campos.
- Eliminación de duplicados exactos.
- Clasificación por familia de rol.
- Sistema de puntuación editable.
- Recomendación de CV.
- Seguimiento de estados de aplicación.
- Fecha automática de aplicación.
- Fecha automática de seguimiento.
- Manejo independiente de errores.
- Procesamiento idempotente.
- Pruebas unitarias de la lógica principal.
- Validaciones con GitHub Actions.
- Despliegue manual mediante `clasp`.
- Modo de ejecución de prueba sin modificar Gmail ni Sheets.
- Documentación de instalación y operación.

## 4.2 Fuera del MVP

- Aplicaciones automáticas.
- Web scraping.
- Automatización de navegador.
- CAPTCHA.
- Web app propia.
- Aplicación móvil.
- Integración con Calendar.
- CRM avanzado de reclutadores.
- Modificación automática de CV.
- Generación automática de cartas de presentación.
- IA generativa para interpretar cada correo.
- Integración con modelos externos.
- Soporte multiusuario.
- Base de datos externa.
- Despliegue automático.

Estas funciones pueden evaluarse después de comprobar que el flujo básico realmente aporta valor.

---

# 5. Principios de diseño

## 5.1 Simplicidad

JobOps debe usar únicamente:

- Google Apps Script.
- JavaScript compatible con Apps Script V8.
- Gmail.
- Google Sheets.
- MailApp.
- PropertiesService.
- LockService.
- `clasp`.
- Node.js para pruebas locales.
- ESLint.
- Prettier.
- GitHub Actions.

No debe existir un proceso de compilación.

El código que se encuentra en `src/` debe ser el mismo código que se despliega a Apps Script.

## 5.2 Separación entre lógica y servicios de Google

Las funciones que realizan cálculos deben recibir datos normales y devolver resultados normales.

Ejemplos de lógica pura:

- Normalizar una URL.
- Calcular un score.
- Clasificar un rol.
- Calcular una fecha de seguimiento.
- Crear una clave de duplicado.
- Elegir un CV.
- Ordenar vacantes para el resumen.

Estas funciones no deben llamar directamente a:

- `GmailApp`.
- `SpreadsheetApp`.
- `MailApp`.
- `PropertiesService`.

Los accesos a servicios de Google deben permanecer en archivos separados.

## 5.3 Escalabilidad pragmática

El sistema debe poder añadir:

- Nuevas plataformas.
- Nuevas reglas de puntuación.
- Nuevas familias de roles.
- Nuevos CV.
- Nuevos campos de configuración.

Sin embargo, no se deben introducir patrones complejos anticipando miles de usuarios o millones de registros.

La escalabilidad requerida es:

- Pasar de siete fuentes a más fuentes.
- Procesar entre decenas y algunos cientos de correos.
- Mantener varios miles de vacantes en una hoja.
- Cambiar la estrategia laboral sin modificar el código.

No se requiere arquitectura distribuida. Una hoja de cálculo y un script no necesitan un service mesh para sentirse importantes.

## 5.4 Idempotencia

Procesar dos veces el mismo correo no debe crear dos registros.

El proceso debe verificar:

- Gmail Message ID.
- URL canónica.
- ID de vacante de la plataforma, cuando exista.
- Clave de deduplicación.

## 5.5 Fallos aislados

Si un correo falla:

- Se registra el error.
- Se aplica la etiqueta correspondiente.
- El resto del lote continúa.

Una excepción no debe cancelar todo el procesamiento.

## 5.6 Protección de datos manuales

Los procesos automáticos no deben sobrescribir campos modificados por el usuario, especialmente:

- Estado.
- Fecha de aplicación existente.
- Fecha de seguimiento manual.
- Notas.
- Información de entrevistas.
- Decisiones manuales sobre prioridad.
- CV seleccionado manualmente.

---

# 6. Arquitectura general

```text
Gmail
  |
  v
Búsqueda de mensajes candidatos
  |
  v
Detección de fuente
  |
  +--> Parser específico de plataforma
  +--> Parser de reclutador
  +--> Parser genérico
  |
  v
Normalización
  |
  v
Deduplicación exacta
  |
  v
Clasificación de rol
  |
  v
Puntuación
  |
  v
Recomendación de CV
  |
  v
Google Sheets
  |
  +--> Etiquetas de Gmail
  +--> Registro de errores
  +--> Resumen diario
```

## Componentes principales

### Gmail Service

Responsable de:

- Buscar mensajes.
- Leer asunto, remitente, fecha y cuerpo.
- Consultar etiquetas.
- Aplicar etiquetas.
- Obtener IDs del mensaje y del hilo.

### Parser Service

Responsable de:

- Detectar la fuente.
- Extraer información.
- Entregar un objeto normalizado.
- Reportar advertencias y nivel de confianza.

### Job Engine

Responsable de:

- Normalización.
- Deduplicación.
- Clasificación.
- Puntuación.
- Recomendación de CV.
- Prioridad.

### Sheets Repository

Responsable de:

- Leer configuración.
- Buscar registros existentes.
- Insertar vacantes.
- Actualizar duplicados exactos.
- Registrar errores.
- Leer aplicaciones pendientes de seguimiento.

### Digest Service

Responsable de:

- Elegir vacantes relevantes.
- Crear el correo HTML.
- Incluir seguimientos.
- Incluir errores pendientes.
- Evitar enviar dos resúmenes el mismo día.

---

# 7. Estructura de Google Sheets

El spreadsheet debe contener las siguientes hojas.

## 7.1 `Jobs`

Tabla principal.

### Columnas administradas por el sistema

- `JOB_ID`
- `DISCOVERED_AT`
- `LAST_UPDATED_AT`
- `SOURCE`
- `ALL_SOURCES`
- `SOURCE_JOB_ID`
- `COMPANY`
- `POSITION`
- `LOCATION`
- `WORK_MODE`
- `JOB_URL`
- `ROLE_FAMILY`
- `MATCH_SCORE`
- `PRIORITY`
- `RECOMMENDED_CV`
- `CV_LINK`
- `SALARY`
- `EXPERIENCE_REQUESTED`
- `REQUIRED_TECHNOLOGIES`
- `STRONG_MATCHES`
- `RISK_FLAGS`
- `RECRUITER_NAME`
- `RECRUITER_EMAIL`
- `GMAIL_MESSAGE_ID`
- `GMAIL_THREAD_ID`
- `DEDUPLICATION_KEY`
- `PARSER`
- `PARSER_VERSION`

### Columnas administradas por el usuario

- `STATUS`
- `APPLIED_DATE`
- `FOLLOW_UP_DATE`
- `NOTES`

El sistema solo debe rellenar `APPLIED_DATE` o `FOLLOW_UP_DATE` cuando estén vacías.

## 7.2 `ScoringRules`

Columnas:

- `RULE_ID`
- `PATTERN`
- `MATCH_TYPE`
- `CONTEXT`
- `SCORE`
- `RISK_FLAG`
- `ENABLED`
- `NOTES`
- `GROUP`

Valores permitidos para `MATCH_TYPE`:

- `KEYWORD`
- `REGEX`
- `PHRASE`
- `ALL_KEYWORDS`

Valores permitidos para `CONTEXT`:

- `ANY`
- `TITLE`
- `REQUIRED`
- `PREFERRED`
- `NEGATIVE`

Ejemplos iniciales:

| Patrón             | Contexto | Score |
| ------------------ | -------: | ----: |
| Linux              |      ANY |     4 |
| RHEL               |      ANY |     4 |
| CI/CD              |      ANY |     4 |
| Docker             |      ANY |     4 |
| AWS                |      ANY |     3 |
| Terraform          |      ANY |     3 |
| Ansible            |      ANY |     3 |
| Prometheus         |      ANY |     3 |
| Grafana            |      ANY |     3 |
| Production Support |      ANY |     3 |
| Python             |      ANY |     2 |
| IAM                |      ANY |     2 |
| Senior             | NEGATIVE |    -5 |
| Lead               | NEGATIVE |    -5 |
| Principal          | NEGATIVE |    -6 |
| 5+ years           | REQUIRED |    -4 |
| 7+ years           | REQUIRED |    -6 |
| Help Desk L1       |      ANY |    -4 |
| sole on-call       | REQUIRED |    -3 |

Las reglas deben poder modificarse desde la hoja sin tocar el código.

## 7.3 `RoleFamilies`

Columnas:

- `ROLE_FAMILY`
- `PATTERNS`
- `PRIORITY_ORDER`
- `RECOMMENDED_CV_PROFILE`
- `MINIMUM_REVIEW_SCORE`
- `ENABLED`
- `NOTES`
- `STRATEGIC_LEVEL`

Valores iniciales:

- `DEVOPS_PLATFORM_SRE`
- `CLOUDOPS_CLOUD_SUPPORT`
- `RELEASE_CICD`
- `APPLICATION_PRODUCTION_SUPPORT`
- `BACKEND_WITH_DEVOPS`
- `BACKEND_PLATFORM_IAM_DEVSECOPS`
- `OTHER_TECHNICAL`
- `UNRELATED`

Las familias iniciales no deben quedar enterradas permanentemente en el código.

## 7.4 `CVProfiles`

Columnas:

- `CV_PROFILE`
- `DRIVE_URL`
- `TARGET_ROLE_FAMILIES`
- `ENABLED`
- `NOTES`

Ejemplos:

- `DEVOPS_PLATFORM`
- `CLOUDOPS_RELEASE_SUPPORT`
- `BACKEND_AUTOMATION`
- `CV_TO_CREATE`

Debe ser posible agregar nuevas variantes de CV sin modificar JavaScript.
Un perfil sin `DRIVE_URL` no se recomienda: devuelve `CV_TO_CREATE` hasta que
se configure el enlace real.

## 7.5 `Sources`

Columnas:

- `SOURCE`
- `SENDER_DOMAINS`
- `SUBJECT_PATTERNS`
- `PARSER_NAME`
- `ENABLED`
- `PRIORITY_MODIFIER`
- `NOTES`

Fuentes iniciales:

- LinkedIn.
- Indeed.
- Get on Board.
- WeRemoto.
- We Work Remotely.
- ElEmpleo.
- Computrabajo.
- Recruiter.
- Generic.

## 7.6 `ParsingErrors`

Columnas:

- `TIMESTAMP`
- `GMAIL_MESSAGE_ID`
- `SENDER`
- `SUBJECT`
- `DETECTED_SOURCE`
- `PARSER`
- `ERROR_TYPE`
- `ERROR_MESSAGE`
- `RETRY_COUNT`
- `RESOLVED`
- `NOTES`

No guardar el cuerpo completo del correo.

## 7.7 `Config`

Columnas:

- `KEY`
- `VALUE`
- `DESCRIPTION`

Configuración inicial:

```text
TIMEZONE = America/Bogota
DIGEST_ENABLED = true
DIGEST_HOUR = configurable
FOLLOW_UP_BUSINESS_DAYS = 5
MAX_MESSAGES_PER_RUN = 100
MAX_DIGEST_JOBS = 10
HIGH_PRIORITY_THRESHOLD = 15
REVIEW_THRESHOLD = 10
OPTIONAL_THRESHOLD = 6
RECRUITER_SCORE_BONUS = configurable
LOOKBACK_DAYS = 7
DRY_RUN = false
```

Datos sensibles o identificadores privados deben almacenarse en Script Properties:

- `SPREADSHEET_ID`
- `USER_EMAIL`

---

# 8. Etiquetas de Gmail

La función de configuración debe crear:

- `Jobs/Processed`
- `Jobs/Failed`
- `Jobs/Recruiters`
- `Jobs/Processing`

## Flujo de etiquetas

### Mensaje procesado correctamente

1. Aplicar `Jobs/Processing`.
2. Procesar.
3. Aplicar `Jobs/Processed`.
4. Remover `Jobs/Processing`.

### Mensaje de reclutador

1. Aplicar `Jobs/Recruiters`.
2. Procesar normalmente.
3. Aplicar `Jobs/Processed`.

### Mensaje con error

1. Registrar el error.
2. Aplicar `Jobs/Failed`.
3. Remover `Jobs/Processing`.
4. Continuar con el siguiente mensaje.

No se requiere que el usuario etiquete manualmente los mensajes.

---

# 9. Búsqueda de mensajes

El proceso automático debe buscar:

- Mensajes de remitentes configurados.
- Alertas recibidas durante los últimos días configurados.
- Mensajes que no hayan sido procesados.
- Posibles mensajes de reclutadores.

La detección de reclutadores debe ser conservadora.

Señales positivas:

- Palabras como `vacancy`, `position`, `opportunity`, `role`, `recruiter`, `interview`, `opening`, `vacante`, `oportunidad`, `cargo`.
- Remitentes personales o corporativos.
- Mención de una posición técnica.
- Enlaces hacia descripción de empleo o calendario de entrevista.

Señales negativas:

- Newsletters generales.
- Cursos.
- Promociones.
- Facturas.
- Alertas internas de sistemas.
- Correos empresariales no relacionados con empleo.

Los patrones deben poder ajustarse en configuración.

---

# 10. Modelo normalizado de vacante

Cada parser debe devolver un objeto con esta forma conceptual:

```javascript
{
  source: "",
  sourceJobId: "",
  company: "",
  position: "",
  location: "",
  workMode: "",
  jobUrl: "",
  salary: "",
  experienceRequested: "",
  requiredTechnologies: [],
  descriptionText: "",
  recruiterName: "",
  recruiterEmail: "",
  parserName: "",
  parserVersion: "",
  confidence: 0,
  warnings: []
}
```

No es necesario usar clases.

Se deben usar objetos simples y funciones pequeñas.

El campo `descriptionText` puede usarse durante el procesamiento, pero no debe guardarse completo en la hoja si contiene información innecesaria.

---

# 11. Parsers

Todos los parsers deben respetar la misma entrada y salida.

Entrada:

```javascript
{
  subject: "",
  from: "",
  date: Date,
  plainBody: "",
  htmlBody: "",
  messageId: "",
  threadId: ""
}
```

Salida:

- Objeto normalizado cuando el correo puede procesarse.
- Error controlado cuando no hay información suficiente.

## Estrategia de implementación

### Fase inicial

Implementar primero:

- Detector de fuente.
- Parser genérico.
- Parser de reclutadores.
- Parser de LinkedIn.
- Parser de Indeed.

### Fase posterior del MVP

Agregar:

- Get on Board.
- WeRemoto.
- We Work Remotely.
- ElEmpleo.
- Computrabajo.

El procesamiento debe funcionar aunque algún parser específico todavía no esté disponible. En ese caso debe utilizarse el parser genérico.

No crear siete parsers basados en suposiciones. Cada parser específico debe construirse usando correos reales anonimizados como fixtures.

---

# 12. Normalización

Debe existir lógica para normalizar:

- Espacios.
- Mayúsculas y minúsculas.
- Entidades HTML.
- Saltos de línea.
- Nombres de empresas.
- Títulos.
- Ubicaciones.
- Modalidad de trabajo.
- URLs.
- Tecnologías.

## Modalidades válidas

- `REMOTE`
- `HYBRID`
- `ONSITE`
- `UNKNOWN`

## URL canónica

Eliminar parámetros conocidos de seguimiento:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `trk`
- `trackingId`
- `ref`
- `source`

Mantener los parámetros cuando sean necesarios para identificar la vacante.

La normalización no debe romper enlaces válidos por intentar ser demasiado inteligente.

---

# 13. Deduplicación

Solo se deben combinar vacantes cuando exista evidencia fuerte de que son exactamente la misma.

Una vacante es duplicada cuando se cumple alguna de estas condiciones:

1. El Gmail Message ID ya fue procesado.
2. La URL canónica es idéntica.
3. La fuente y el Source Job ID son idénticos.
4. La clave de deduplicación exacta coincide y los campos principales no presentan diferencias.

La clave puede construirse con:

```text
source + sourceJobId
```

o, cuando no exista ID:

```text
canonicalUrl
```

No usar únicamente empresa y cargo para eliminar duplicados.

Dos vacantes con el mismo cargo en la misma empresa pueden ser diferentes.

Cuando se recibe la misma vacante desde otra plataforma:

- Mantener una sola fila.
- Agregar la nueva fuente en `ALL_SOURCES`.
- Actualizar `LAST_UPDATED_AT`.
- Conservar la mejor información disponible.
- No sobrescribir el estado ni las notas.

---

# 14. Clasificación de roles

La clasificación debe utilizar:

- Título.
- Descripción normalizada.
- Tecnologías.
- Patrones configurados en `RoleFamilies`.

Debe devolver:

- Familia seleccionada.
- Patrones coincidentes.
- Confianza estimada.

Cuando ninguna familia tenga suficiente evidencia:

```text
OTHER_TECHNICAL
```

o:

```text
UNCLASSIFIED
```

La estrategia profesional todavía puede cambiar. Por eso la clasificación debe ser editable desde Sheets y no una sentencia divina escrita en un `switch` de 180 líneas.

---

# 15. Puntuación

El sistema debe:

1. Leer reglas habilitadas.
2. Revisar título y descripción.
3. Aplicar reglas positivas.
4. Aplicar reglas negativas.
5. Distinguir requerimientos de preferencias cuando sea posible.
6. Aplicar el bono de reclutador.
7. Guardar las coincidencias.
8. Guardar riesgos.
9. Calcular prioridad.

## Prioridades iniciales

```text
15 o más: HIGH
10 a 14: REVIEW
6 a 9: OPTIONAL
Menos de 6: LOW
```

Las oportunidades con prioridad `LOW` deben permanecer visibles, pero no deben ocupar espacio en el resumen principal.

## Explicabilidad

Cada puntuación debe poder explicarse.

Ejemplo:

```text
Strong Matches:
Linux +4
Docker +4
CI/CD +4
AWS +3

Risk Flags:
Senior title -5
5+ years required -4

Final Score: 6
```

No devolver únicamente un número mágico.

---

# 16. Recomendación de CV

La recomendación debe usar:

- Familia de rol.
- Configuración de `CVProfiles`.
- Disponibilidad de un CV habilitado.

Salida:

- Nombre del perfil.
- Enlace de Google Drive.
- Motivo de selección.

Cuando no exista un CV adecuado:

```text
CV_TO_CREATE
```

JobOps no debe:

- Modificar el archivo.
- Crear copias.
- Adjuntarlo.
- Enviarlo.
- Generar versiones improvisadas.

---

# 17. Estados de aplicación

Estados válidos:

- `NEW`
- `REVIEW`
- `READY`
- `APPLIED`
- `FOLLOW_UP`
- `SCREENING`
- `TECHNICAL`
- `REJECTED`
- `GHOSTED`
- `OFFER`
- `SKIPPED`

## Automatización al cambiar a `APPLIED`

Cuando el usuario cambie una fila a `APPLIED`:

- Rellenar `APPLIED_DATE` si está vacía.
- Calcular `FOLLOW_UP_DATE` si está vacía.
- Usar días hábiles.
- No sobrescribir fechas existentes.

La automatización debe ejecutarse mediante un trigger instalable `onEdit`.

No debe enviarse automáticamente ningún mensaje de seguimiento.

---

# 18. Resumen diario

El resumen debe enviarse mediante correo HTML.

## Contenido

### Nuevas oportunidades prioritarias

Máximo configurado, inicialmente diez.

Cada oportunidad debe mostrar:

- Empresa.
- Cargo.
- Fuente.
- Ubicación.
- Modalidad.
- Score.
- Prioridad.
- Familia.
- CV recomendado.
- Coincidencias fuertes.
- Riesgos.
- Enlace para revisar o aplicar.

### Oportunidades de reclutadores

Deben aparecer en una sección separada o claramente marcada.

### Seguimientos vencidos

Mostrar aplicaciones cuyo seguimiento esté pendiente.

### Errores de procesamiento

Mostrar únicamente un resumen:

- Cantidad.
- Fuente.
- Asunto.
- Tipo de error.

No incluir cuerpos completos de correo.

## Reglas

- Zona horaria: `America/Bogota`.
- Hora configurable.
- No enviar más de un resumen al día.
- No enviar correo vacío, salvo que la configuración lo indique.
- Registrar la fecha del último resumen en Script Properties.

---

# 19. Funciones globales de Apps Script

Estas funciones deben quedar accesibles desde Apps Script:

```javascript
function setupJobOps() {}
function installJobOpsTriggers() {}
function ingestJobs() {}
function sendDailyDigest() {}
function handleStatusEdit(event) {}
function rescoreJobs() {}
function dryRunIngestion() {}
function validateJobOpsConfiguration() {}
```

## Responsabilidades

### `setupJobOps`

- Crear hojas.
- Crear encabezados.
- Crear etiquetas de Gmail.
- Crear validaciones.
- Crear formatos condicionales.
- Insertar configuración inicial.
- No sobrescribir datos existentes.

### `installJobOpsTriggers`

- Crear trigger de ingestión.
- Crear trigger del resumen.
- Crear trigger instalable de edición.
- Evitar triggers duplicados.

### `ingestJobs`

- Adquirir lock.
- Leer configuración.
- Buscar mensajes.
- Procesar cada mensaje independientemente.
- Guardar resultados en lote.
- Aplicar etiquetas.
- Registrar resumen de ejecución.

### `sendDailyDigest`

- Verificar si ya fue enviado.
- Leer vacantes relevantes.
- Leer seguimientos.
- Leer errores.
- Generar HTML.
- Enviar.
- Registrar la ejecución.

### `handleStatusEdit`

- Validar hoja y columna.
- Detectar transición a `APPLIED`.
- Completar fechas faltantes.
- No realizar operaciones costosas innecesarias.

### `rescoreJobs`

- Recalcular clasificación y score de registros existentes.
- No sobrescribir estados, notas ni fechas.

### `dryRunIngestion`

- Buscar y procesar mensajes.
- Mostrar resultados en logs.
- No modificar Gmail.
- No escribir en Sheets.
- No enviar correos.

---

# 20. Estructura del repositorio

```text
jobops/
├── AGENTS.md
├── README.md
├── appsscript.json
├── package.json
├── eslint.config.js
├── .prettierrc.json
├── .clasp.json.example
├── .gitignore
├── docs/
│   ├── PRD.md
│   ├── SETUP.md
│   ├── OPERATIONS.md
│   └── TESTING.md
├── .codex/
│   └── skills/
│       └── jobops/
│           └── SKILL.md
├── src/
│   ├── 00_Constants.js
│   ├── 01_Config.js
│   ├── 02_Utilities.js
│   ├── 03_Normalization.js
│   ├── 04_Deduplication.js
│   ├── 05_Parsers.js
│   ├── 06_Classification.js
│   ├── 07_Scoring.js
│   ├── 08_CvRecommendation.js
│   ├── 09_GmailService.js
│   ├── 10_SheetsRepository.js
│   ├── 11_DigestService.js
│   ├── 12_StatusWorkflow.js
│   ├── 13_Setup.js
│   └── 14_Entrypoints.js
├── tests/
│   ├── fixtures/
│   │   ├── linkedin/
│   │   ├── indeed/
│   │   ├── recruiters/
│   │   └── malformed/
│   ├── normalization.test.js
│   ├── deduplication.test.js
│   ├── parsers.test.js
│   ├── classification.test.js
│   ├── scoring.test.js
│   ├── cvRecommendation.test.js
│   └── followUp.test.js
├── scripts/
│   └── validate-manifest.js
└── .github/
    └── workflows/
        └── ci.yml
```

## Motivo de la estructura plana en `src`

Apps Script no utiliza módulos estándar de Node.js.

Una estructura plana:

- Evita bundlers.
- Facilita `clasp push`.
- Hace visibles las dependencias.
- Reduce configuración.
- Funciona bien para el tamaño esperado.

Los prefijos numéricos facilitan la lectura en el editor de Apps Script, pero el código no debe depender de efectos secundarios durante la carga.

---

# 21. Estilo de código

## Reglas

- Usar `const` y `let`.
- Evitar `var`, excepto cuando Apps Script requiera exponer algo global.
- Usar nombres descriptivos.
- Mantener funciones pequeñas.
- Evitar clases salvo necesidad real.
- Usar objetos simples.
- Usar JSDoc para estructuras importantes.
- Evitar mutación innecesaria.
- No usar callbacks profundamente anidados.
- No capturar errores sin registrarlos.
- No usar números mágicos.
- No duplicar encabezados o nombres de hojas.
- Centralizar constantes.
- Separar funciones puras de I/O.
- Usar operaciones por lote en Sheets.
- Usar `LockService` en procesos programados.
- Evitar escribir celda por celda.
- No guardar el cuerpo completo de los correos en logs.

## JSDoc

Ejemplo:

```javascript
/**
 * @typedef {Object} ParsedJob
 * @property {string} source
 * @property {string} company
 * @property {string} position
 * @property {string} location
 * @property {string} workMode
 * @property {string} jobUrl
 * @property {string[]} requiredTechnologies
 * @property {string[]} warnings
 */
```

No convertir JSDoc en TypeScript disfrazado. Se utiliza para claridad y autocompletado, no para construir un sistema de tipos barroco.

---

# 22. Pruebas

Las pruebas locales deben usar el runner nativo de Node.js:

```text
node:test
```

Esto evita agregar Jest o Vitest sin necesidad.

## Probar como lógica pura

- Normalización de URLs.
- Eliminación de tracking.
- Normalización de títulos.
- Normalización de modalidad.
- Claves de deduplicación.
- Clasificación de rol.
- Reglas positivas.
- Reglas negativas.
- Contexto required/preferred.
- Umbrales de prioridad.
- Recomendación de CV.
- Cálculo de días hábiles.
- Orden del resumen.
- Transiciones de estado.
- Parsers usando fixtures anonimizados.

## No intentar probar localmente

- El funcionamiento interno de GmailApp.
- El funcionamiento interno de SpreadsheetApp.
- El envío real de MailApp.

Estas integraciones deben estar detrás de funciones pequeñas y verificarse con pruebas manuales controladas.

## Compatibilidad con Node

Las funciones puras pueden exponerse para pruebas usando:

```javascript
if (typeof module !== 'undefined') {
  module.exports = {
    canonicalizeUrl,
    calculateScore,
  };
}
```

El bloque no afecta Apps Script porque `module` no existe allí.

---

# 23. Scripts de npm

`package.json` debe incluir como mínimo:

```json
{
  "scripts": {
    "lint": "eslint src tests scripts",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "node --test",
    "validate:manifest": "node scripts/validate-manifest.js",
    "ci": "npm run lint && npm run format:check && npm run test && npm run validate:manifest",
    "push": "clasp push",
    "open": "clasp open"
  }
}
```

Dependencias de desarrollo mínimas:

- `@google/clasp`
- `eslint`
- `prettier`
- Los paquetes estrictamente necesarios para configurar ESLint.

No agregar dependencias sin justificar qué problema real resuelven.

---

# 24. GitHub Actions

El workflow debe ejecutarse en:

- Push.
- Pull request.

Pasos:

1. Checkout.
2. Configurar Node.js.
3. Ejecutar `npm ci`.
4. Ejecutar `npm run ci`.

CI no debe:

- Acceder a Gmail.
- Acceder a Sheets.
- Usar credenciales reales.
- Ejecutar `clasp push`.
- Desplegar a Apps Script.

El propósito de CI es validar el código, no tomar decisiones creativas sobre producción.

---

# 25. Seguridad y privacidad

## Prohibido guardar en Git

- `.clasp.json` real.
- Spreadsheet ID real.
- Correos personales reales en fixtures.
- Contenido real de Gmail.
- CV.
- Tokens.
- Credenciales.
- IDs privados.
- Datos de reclutadores sin anonimizar.

## Script Properties

Usar Script Properties para:

- `SPREADSHEET_ID`
- `USER_EMAIL`
- `LAST_DIGEST_DATE`
- Cualquier dato sensible futuro.

## Logs

Los logs pueden incluir:

- Message ID parcial.
- Fuente.
- Parser.
- Resultado.
- Tipo de error.
- Duración.
- Número de registros procesados.

No deben incluir:

- Cuerpo completo del correo.
- CV.
- Información personal innecesaria.
- Credenciales.
- Tokens.
- Conversaciones completas con reclutadores.

---

# 26. Rendimiento

- Cargar configuración una sola vez por ejecución.
- Leer registros existentes en una sola operación.
- Crear índices en memoria para deduplicación.
- Acumular filas nuevas y escribirlas en lote.
- Acumular actualizaciones y aplicarlas por bloques.
- Limitar mensajes por ejecución.
- Usar rango de fechas en búsquedas de Gmail.
- Evitar abrir repetidamente el mismo spreadsheet.
- Usar `LockService` para prevenir ejecuciones simultáneas.
- Liberar el lock dentro de `finally`.

Objetivo inicial:

- Procesar hasta 100 mensajes por ejecución.
- Mantener operación aceptable con varios miles de filas.

No optimizar para millones de registros. Cuando una hoja con millones de vacantes se convierta en el problema, será una tragedia bastante exitosa.

---

# 27. Manejo de errores

Crear errores reconocibles mediante campos o nombres claros:

- `CONFIGURATION_ERROR`
- `SOURCE_NOT_DETECTED`
- `PARSER_ERROR`
- `MISSING_REQUIRED_FIELD`
- `SHEETS_WRITE_ERROR`
- `GMAIL_LABEL_ERROR`
- `DUPLICATE_MESSAGE`
- `DIGEST_ERROR`

Cada procesamiento debe usar una estructura equivalente a:

```javascript
try {
  processMessage(message);
} catch (error) {
  recordParsingError(message, error);
  labelMessageAsFailed(message);
}
```

El procesamiento del lote debe continuar.

---

# 28. Fases de implementación

## Fase 0 — Repositorio y reglas de trabajo

### Implementar

- Estructura del repositorio.
- `AGENTS.md`.
- `docs/PRD.md`.
- Skill de Codex.
- `package.json`.
- ESLint.
- Prettier.
- Prueba de humo.
- Validación de manifest.
- GitHub Actions.
- Entrypoints vacíos válidos.
- `.gitignore`.
- `.clasp.json.example`.

### Terminado cuando

- `npm ci` funciona.
- `npm run ci` pasa.
- `clasp` reconoce el proyecto.
- No hay credenciales.
- Los entrypoints cargan sin hacer operaciones reales.

No avanzar a la siguiente fase hasta completar esta.

---

## Fase 1 — Configuración inicial

### Implementar

- Constantes de hojas y columnas.
- Lectura de Script Properties.
- Lectura de `Config`.
- Validación de configuración.
- Creación de hojas.
- Creación de encabezados.
- Creación de etiquetas.
- Validación de estados.
- Formato de la hoja.
- Dropdowns.
- Formato condicional básico.

### Terminado cuando

Ejecutar `setupJobOps()` sobre un spreadsheet vacío crea un entorno utilizable sin destruir datos existentes.

---

## Fase 2 — Ingestión mínima funcional

### Implementar

- Búsqueda de Gmail.
- Lectura de mensajes.
- Detección de fuente.
- Parser genérico.
- Parser de reclutador.
- Normalización básica.
- Escritura en `Jobs`.
- Etiquetas Processed y Failed.
- Registro en `ParsingErrors`.
- Dry run.
- Lock de ejecución.

### Terminado cuando

- Un correo válido genera una fila.
- Un correo de reclutador genera una fila con prioridad adicional.
- Un correo defectuoso genera un error.
- Un error no detiene el lote.
- El dry run no modifica datos.

Este es el primer resultado realmente útil.

---

## Fase 3 — Parsers y deduplicación

### Implementar

- Parser LinkedIn.
- Parser Indeed.
- Parsers restantes según fixtures disponibles.
- URL canónica.
- Source Job ID.
- Gmail Message ID.
- Clave de duplicación.
- Actualización de `ALL_SOURCES`.
- Protección de campos manuales.

### Terminado cuando

- Reprocesar un mensaje no duplica.
- La misma URL no duplica.
- Vacantes similares pero diferentes permanecen separadas.
- Una segunda fuente actualiza la fila existente.

---

## Fase 4 — Clasificación, score y CV

### Implementar

- Lectura de `RoleFamilies`.
- Clasificación.
- Lectura de `ScoringRules`.
- Score.
- Strong matches.
- Risk flags.
- Prioridad.
- Bono de reclutador.
- Lectura de `CVProfiles`.
- Recomendación de CV.
- Función de rescore.

### Terminado cuando

- Cambiar una regla en Sheets cambia el resultado.
- Cada score es explicable.
- La recomendación de CV tiene nombre y enlace.
- `rescoreJobs()` conserva datos manuales.

---

## Fase 5 — Flujo de aplicaciones y resumen

### Implementar

- Trigger de edición.
- Transición a APPLIED.
- Fecha de aplicación.
- Fecha de seguimiento.
- Días hábiles.
- Selección del top diario.
- Resumen HTML.
- Sección de reclutadores.
- Sección de seguimientos.
- Sección de errores.
- Prevención de resumen duplicado.

### Terminado cuando

El usuario puede trabajar diariamente usando únicamente el Sheet y el resumen.

---

# Estrategia de búsqueda y priorización

JobOps usa una estrategia doble y editable desde Sheets:

- Roles directos de entrada: `DEVOPS_CLOUDOPS_JR` y `PLATFORM_SRE_ASSOCIATE` (`DIRECT`).
- Roles puente: Cloud/Application/Production Support, Release/CI/CD, Linux Infrastructure y Backend con operación (`BRIDGE`).
- Especialidades secundarias: observabilidad/NOC e IAM/DevSecOps (`SECONDARY`).

`RoleFamilies` incorpora `STRATEGIC_LEVEL`. `ScoringRules` incorpora `GROUP`,
`TITLE` y `ALL_KEYWORDS`; este último separa condiciones con `|` para sinergias
simples, y un grupo evita sumar variantes equivalentes varias veces. Las reglas
siguen siendo editables desde la hoja.

`setupJobOps()` agrega de forma idempotente las filas estándar y solo actualiza
una fila que coincida exactamente con un valor inicial anterior. Configuración,
notas, enlaces de Drive, vacantes y sus campos manuales se conservan. Después
de revisar los cambios, ejecuta `rescoreJobs()` manualmente: nunca se ejecuta
automáticamente durante la migración.

La prioridad combina score y nivel estratégico. El digest aplica una mezcla
aproximada de roles directos, soporte técnico, backend con DevOps,
infraestructura/release y especialidades, sin forzar cuotas si no hay vacantes.

La recomendación usa `DEVOPS_PLATFORM`, `CLOUDOPS_SUPPORT` o
`BACKEND_AUTOMATION` según la familia. Si el perfil no existe o no tiene enlace
en `DRIVE_URL`, el resultado es `CV_TO_CREATE`.

## Fase 6 — Endurecimiento

### Implementar

- Fixtures adicionales.
- Casos borde.
- Reintentos limitados.
- Logs estructurados.
- Documentación de recuperación.
- Validación de triggers.
- Revisión de permisos.
- Prueba con correos reales.
- Correcciones de parsers.

### Terminado cuando

- CI pasa.
- La instalación es reproducible.
- Un correo extraño no rompe el sistema.
- Los errores son visibles.
- El sistema puede operarse sin entrar al código diariamente.

---

# 29. Criterios de éxito del MVP

JobOps versión 1 está terminado cuando:

- Procesa automáticamente alertas conocidas.
- Procesa correos de reclutadores.
- Crea registros en Google Sheets.
- Evita duplicados exactos.
- Mantiene separadas vacantes diferentes.
- Clasifica cada oportunidad.
- Calcula un score explicable.
- Recomienda un CV configurable.
- Prioriza mensajes de reclutadores.
- Permite registrar aplicaciones.
- Calcula seguimientos.
- Envía un resumen diario en horario de Bogotá.
- Registra errores sin detener el lote.
- Tiene dry run.
- Tiene pruebas sobre la lógica crítica.
- GitHub Actions valida el repositorio.
- El despliegue se realiza manualmente.
- No automatiza ninguna aplicación laboral.

---

# 30. Contenido de `.codex/skills/jobops/SKILL.md`

```markdown
---
name: jobops
description: Implementar y mantener JobOps con JavaScript nativo de Google Apps Script, priorizando simplicidad, confiabilidad, pruebas y entrega incremental.
---

# JobOps Engineering Skill

## Misión

Construir funcionalidades concretas y confiables para JobOps sin introducir complejidad que el problema no requiere.

## Antes de modificar código

1. Leer `docs/PRD.md`.
2. Leer `AGENTS.md`.
3. Identificar la fase activa.
4. Inspeccionar el código existente.
5. Ejecutar `npm run ci`.
6. Explicar brevemente qué se va a cambiar.

## Reglas obligatorias

- Usar JavaScript compatible con Apps Script V8.
- No usar TypeScript.
- No usar imports ni exports en código desplegado.
- No usar bundlers.
- No agregar frameworks.
- No añadir una dependencia sin justificarla.
- Mantener lógica pura separada de Gmail y Sheets.
- Usar JSDoc en estructuras importantes.
- Preferir funciones pequeñas y nombres explícitos.
- Procesar registros por lotes.
- Preservar campos editados por el usuario.
- Mantener la ingestión idempotente.
- Aislar errores por mensaje.
- No guardar datos reales en tests.
- No desplegar desde CI.
- No automatizar aplicaciones laborales.

## Criterio de escalabilidad

Añadir abstracción solamente cuando ocurra al menos una de estas condiciones:

1. Existen dos o más implementaciones reales del mismo comportamiento.
2. Una función mezcla lógica de negocio con acceso a Google.
3. Un archivo se vuelve difícil de probar o entender.
4. Un cambio frecuente obliga a editar múltiples lugares.
5. La configuración puede moverse razonablemente a Sheets.

No crear capas por una posible necesidad futura sin evidencia.

## Método de implementación

Para cada cambio:

1. Definir comportamiento esperado.
2. Escribir o actualizar pruebas de lógica pura.
3. Implementar la solución mínima.
4. Ejecutar lint, formato y pruebas.
5. Revisar manejo de errores.
6. Revisar idempotencia.
7. Revisar que no se sobrescriban campos manuales.
8. Actualizar documentación cuando corresponda.

## Revisión obligatoria antes de terminar

- ¿Funciona en Apps Script V8?
- ¿Se puede probar sin Google cuando es lógica pura?
- ¿Hay alguna operación celda por celda que pueda agruparse?
- ¿Puede repetirse sin duplicar datos?
- ¿Un fallo afecta solo al mensaje actual?
- ¿Se preservan estado, notas y fechas manuales?
- ¿Se añadió complejidad que no aporta valor inmediato?
- ¿`npm run ci` pasa?

## Formato del reporte de trabajo

Al terminar una fase o tarea, informar:

- Archivos modificados.
- Comportamiento implementado.
- Pruebas agregadas.
- Resultado de `npm run ci`.
- Riesgos o límites conocidos.
- Próximo paso recomendado.

No avanzar automáticamente a otra fase cuando la instrucción solicite trabajar únicamente en una fase.
```

---

# 31. Contenido de `AGENTS.md`

```markdown
# JobOps repository instructions

Read these files before making changes:

1. `docs/PRD.md`
2. `.codex/skills/jobops/SKILL.md`

JobOps uses native JavaScript for Google Apps Script.

Do not introduce:

- TypeScript.
- Bundlers.
- Frontend frameworks.
- External databases.
- Automated deployment.
- Job-board scraping.
- Automatic job applications.

Work one phase at a time.

Before completing any task, run:

npm run ci

Preserve user-managed spreadsheet fields and keep Gmail/Sheets access separate from pure domain logic.
```

---

# 32. Prompt maestro para iniciar el repositorio con Codex

```text
Implementa JobOps siguiendo `docs/PRD.md`, `AGENTS.md` y `.codex/skills/jobops/SKILL.md`.

JobOps es un sistema privado y de un solo usuario construido con JavaScript nativo para Google Apps Script.

Restricciones:

- No uses TypeScript.
- No uses bundlers.
- No uses imports o exports incompatibles con Apps Script.
- No uses frameworks de frontend.
- No uses bases de datos externas.
- No hagas scraping.
- No automatices aplicaciones laborales.
- No despliegues desde CI.
- No agregues dependencias sin justificar su necesidad.
- No guardes datos personales reales, correos, CV o identificadores privados en Git.

Principios:

- Código concreto, limpio y entendible.
- Funciones pequeñas.
- JSDoc para estructuras importantes.
- Lógica pura separada de Gmail y Google Sheets.
- Procesamiento idempotente.
- Errores aislados por mensaje.
- Operaciones de Sheets en lote.
- Configuración editable desde Sheets.
- Protección de campos modificados manualmente.
- Escalabilidad pragmática sin sobrearquitectura.

Trabaja únicamente en la Fase 0.

Para la Fase 0:

1. Crea la estructura inicial del repositorio.
2. Configura JavaScript, ESLint y Prettier.
3. Usa `node:test` para pruebas locales.
4. Configura `@google/clasp`.
5. Crea un `appsscript.json` seguro.
6. Crea `.clasp.json.example`.
7. Crea `.gitignore`.
8. Crea `scripts/validate-manifest.js`.
9. Configura GitHub Actions para ejecutar `npm run ci`.
10. Crea los entrypoints globales como funciones vacías seguras.
11. Agrega al menos una prueba de humo.
12. Documenta requisitos y comandos locales en README.
13. Comprueba que `npm run ci` pase.

No implementes todavía acceso real a Gmail, Sheets, PropertiesService o MailApp.

Al terminar:

- Resume los archivos creados.
- Muestra el resultado de las validaciones.
- Indica cualquier decisión técnica tomada.
- No avances a la Fase 1.
```

---

# 33. Decisión técnica final

La implementación debe comenzar sin:

- TypeScript.
- Compilación.
- Bundling.
- Interfaces ceremoniales.
- Inyección de dependencias compleja.
- Patrones empresariales innecesarios.

La base será JavaScript nativo, funciones puras, servicios pequeños y configuración en Sheets.

Cuando aparezca una necesidad real de crecimiento, el diseño permite:

- Añadir parsers.
- Añadir reglas.
- Añadir CV.
- Añadir familias.
- Cambiar prioridades.
- Procesar más correos.

Todo esto sin convertir el MVP en una plataforma que necesite tres arquitectos, dos scrum masters y una reunión para decidir el nombre de una función.
