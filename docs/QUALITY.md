# Calidad de oportunidades

## Fase 1

La ingesta nueva extrae requisitos explícitos en memoria sin llamadas adicionales
de IA. Conserva MATCH_SCORE y aplica el fit por separado. Senior no puede quedar
HIGH; experiencia profesional cloud/Kubernetes exige revisión del perfil.
FIT_REASONS contiene evidencia compacta y UNKNOWN para datos ausentes. Las
tecnologías deseables no se convierten en requisitos obligatorios. No se guarda
la descripción completa. Las familias y reglas de Sheets siguen siendo la base.

No se recalifican registros históricos automáticamente. El fit es una ayuda de
revisión, no una certificación de elegibilidad ni dominio de todas las habilidades.
La extracción conservadora puede omitir requisitos redactados de otras formas.

## Vista previa y dashboard

`dryRunJobDiscovery()` devuelve hasta 20 candidatas ordenadas, además de sus
contadores. El botón Descubrir presenta estos mismos resultados sin otra consulta
y sin controles de edición. El dry run no prepara el esquema ni escribe Jobs.
Todas incluye LOW y las aplicaciones siguen accesibles. pendingFit cuenta
evaluaciones sin versión; unknownFit incluye información insuficiente aunque
ya se haya evaluado. Los contadores visibles corresponden a los filtros actuales.

El descubrimiento aplica las protecciones de prioridad después de calcular el
fit: pasantías y cargos de alta responsabilidad tienen un límite de OPTIONAL.
Las correcciones de familias puente usan FINAL_SCORE cuando existe evaluación y
conservan el límite de FIT_LEVEL; no sustituyen el fit por UNKNOWN. El cambio
afecta únicamente a candidatas nuevas y no repara datos históricos al desplegar.

## Disponibilidad

Ejecutar manualmente `checkJobAvailability()` tras desplegar. No instala triggers.
Crea únicamente Availability y añade evidencia, preservando Jobs. Comprueba
Himalayas mediante SOURCE_JOB_ID, máximo 20 solicitudes diarias y una por vacante
cada 24 horas. Script Property AVAILABILITY_DAILY_LIMIT permite reducir el límite.
Detiene el lote y los siguientes del día ante 429. HTTP 404, errores y cuerpos
inválidos son UNKNOWN; CLOSED exige 410 con expiryDate. El dashboard conserva la
aplicación y desactiva el enlace de una vacante con cierre confirmado.

Referencia oficial verificada el 2026-10-29:
https://himalayas.app/docs/remote-jobs-api. No se consulta la página web.

## Métricas y límites pendientes

El dashboard muestra contadores por fuente y familia sobre todos los registros.
Las entrevistas representan estados actuales SCREENING, TECHNICAL y OFFER;
no permiten reconstruir entrevistas previas a un rechazo. No se atribuye éxito a
un CV recomendado sin prueba de que fue utilizado. Falta historial de transiciones
y presentación tabular de tasas, comparación agregada objetivo/puente y eficacia
por CV. Estas métricas no deben interpretarse como conversión histórica completa.

## Activación segura

Revisar el PR y desplegar manualmente con el procedimiento de SETUP.md. No se
requiere recalificar datos históricos para usar las nuevas funciones. Probar
primero dryRunJobDiscovery y revisar las candidatas. No ejecutar rescoreJobs ni
la migración histórica como parte de esta activación. La actualización de
evaluaciones ahora respeta rowNumber y conserva el CV existente.
