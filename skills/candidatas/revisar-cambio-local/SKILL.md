---
name: revisar-cambio-local
description: Revisa una diferencia local para encontrar regresiones respaldadas por archivos, líneas y resultados de comprobación.
---

# Revisar un cambio local

1. Delimita la diferencia y el comportamiento pedido. Si hay Git, inspecciona el estado y distingue cambios preparados, sin preparar y archivos nuevos. Preserva el trabajo existente.
2. Sigue el cambio desde su punto de entrada hasta el resultado. Compara el caso nuevo con el comportamiento previo de los llamadores y revisa las condiciones que pueden cambiar el resultado.
3. Usa comprobaciones reproducibles que estén dentro del alcance autorizado. Distingue lo observado en el código de lo ejecutado y anota las pruebas pendientes.
4. Presenta primero los hallazgos que requieren acción. Para cada uno, identifica ubicación, entrada que lo desencadena, resultado observado o inferido e impacto. Si no encuentras hallazgos, indica el alcance de la revisión y qué falta comprobar.

Una revisión por sí sola autoriza inspeccionar. Aplica cambios solo si el encargo también los pide.
