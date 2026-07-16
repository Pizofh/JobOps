# Operación

## Estado de la Fase 0

Los ocho entrypoints globales existen para que Apps Script pueda cargarlos, pero son funciones intencionalmente inertes. En esta fase no hay ingestión, configuración de hojas, triggers, resumen, cambios de estado ni rescoring operativos.

## Rutina disponible

- Ejecutar `npm run ci` antes de integrar cambios.
- Revisar que `.clasp.json` siga ignorado y que no existan credenciales versionadas.
- Usar `npx clasp show-file-status` para confirmar la lista de despliegue.
- Desplegar únicamente de forma manual y solo cuando una fase posterior lo autorice.

Las instrucciones de operación diaria se ampliarán cuando exista comportamiento funcional, sin adelantar implementaciones de fases posteriores.
