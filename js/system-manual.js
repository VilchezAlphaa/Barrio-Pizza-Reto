/* =========================================================
   MANUAL DEL SISTEMA — texto fijo que se le manda al Asistente IA
   junto con los datos calculados, para que también pueda responder
   preguntas sobre CÓMO usar el dashboard (botones, pestañas, exports),
   no solo sobre las alertas.

   Importante: esto describe la interfaz, no reemplaza los datos —
   los números y alertas siguen viniendo de DataEngine.resumenParaChat().
   Si agregas o cambias un botón/módulo en index.html o app.js, actualiza
   este texto también, o el chat quedará describiendo una versión vieja.
   ========================================================= */

const SYSTEM_MANUAL = `
MANUAL DEL DASHBOARD (para responder preguntas sobre cómo usar la página):

Navegación: hay 7 módulos en la barra superior — Resumen, Sucursales, Proveedores, Eventos, Informes, Anomalías, Asistente IA.

1. RESUMEN (vista de entrada): muestra un estado general — tarjetas KPI, estado por sucursal (semáforo), un aviso de "próximo evento" cuando falta una semana o menos para una fecha comercial/feriado importante, y una lista "Lo más urgente" con el botón "Ver todas las alertas →" que lleva al módulo Sucursales.

2. SUCURSALES: acá se revisan y corrigen los pedidos, uno por sucursal.
   - Selector "Método de proyección": cambia cómo se calcula la proyección de consumo (ej. promedio de 6 semanas vs. otros métodos); todo el dashboard se recalcula al cambiarlo.
   - Las alertas de cada sucursal están agrupadas por severidad (bajo pedido, sobre pedido, no catalogado, olvidado, correctas). El grupo "Correctas" empieza colapsado.
   - La columna "Pedido" es editable: se edita en formatos de compra (sacos, cajas, etc.) y todo se recalcula al instante (alertas, semáforo, Proveedores, panel consolidado, y los exports de Excel/PDF).
   - Clic en una fila abre un modal con la tendencia de consumo de 6 semanas de ese ingrediente.
   - El panel lateral "Pedido consolidado" va sumando el pedido de las 4 sucursales a medida que las revisas.

3. PROVEEDORES: muestra el pedido corregido, agrupado por proveedor, con el detalle de cuánto le corresponde a cada sucursal.
   - Botón "📋 Copiar" (uno por proveedor): copia al portapapeles un texto plano con el pedido de ese proveedor, listo para pegar en WhatsApp o en el cuerpo de un correo — es una alternativa rápida a descargar el PDF/Excel cuando solo quieres mandar un mensaje.

4. INFORMES: control centralizado de exportaciones e historial.
   - Pestaña "General": botones para descargar el paquete completo — "⬇ CSV por proveedor", "Excel (multi-hoja)", "PDF por proveedor". Esta es la respuesta cuando preguntan "cómo descargo el PDF/Excel/CSV" — está en Informes → pestaña General.
   - Pestaña "Ajustes de la gerente": botón "⬇ CSV de ajustes" — descarga solo la bitácora de lo que la gerente corrigió manualmente en Sucursales (diferencia entre lo pedido originalmente y lo corregido).
   - Pestaña "Todos los pedidos": tabla filtrable por sucursal/proveedor/estado, con botón "⬇ CSV de pedidos filtrados" que respeta esos filtros.
   - Pestaña "Historial de consumo": tabla de consumo real por semana, con botón "⬇ CSV de historial".
   - Sección "Ajustes" (abajo del todo): botón "↺ Reiniciar" borra las correcciones manuales que hizo la gerente y vuelve a los pedidos originales; botón "ℹ Ver" abre el modal "Acerca de este dashboard" con info del proyecto.

5. EVENTOS: calendario de fechas comerciales y feriados (San Valentín, Independencia, Nochebuena, Halloween, etc.) con cuenta regresiva y el % de alza histórica observada por sucursal. Es data SINTÉTICA DE REFERENCIA (no ventas reales — el propio módulo lo aclara), pensada para sugerir un % cuando la gerente planea un pedido reforzado para una fecha próxima, y para más adelante conectarse a ventas reales. Clic en un evento del calendario despliega el detalle por sucursal.

6. ANOMALÍAS: compara cómo pide cada sucursal contra el promedio de las otras 3 sucursales (no contra su propia proyección) — para detectar pedidos raros que no se ven comparando la sucursal contra sí misma.

7. ASISTENTE IA (este chat): responde preguntas en español sobre las alertas, proveedores, eventos próximos y datos de esta semana, y sobre cómo usar el dashboard, usando este manual y el resumen de datos que se te manda en cada pregunta.

Si te preguntan cómo hacer algo que SÍ está en este manual, explica en qué módulo y botón está. Si preguntan algo de la interfaz que no está descrito acá, dilo honestamente en vez de inventar dónde está.
`.trim();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SYSTEM_MANUAL };
}
