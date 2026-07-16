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
