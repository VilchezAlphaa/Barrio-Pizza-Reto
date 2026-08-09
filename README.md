# Barrio Pizza — Dashboard de Revisión de Órdenes de Compra

Dashboard que revisa automáticamente las órdenes de compra semanales de 4 sucursales,
proyecta el consumo, y genera alertas accionables para la gerente de compras.

**Demo en vivo:** [barrio-pizza-reto-phi.vercel.app](https://barrio-pizza-reto-phi.vercel.app/)

---

## Cómo correrlo localmente

Es un sitio 100% estático (HTML/CSS/JS puro, sin build step), así que solo necesitas
un servidor local simple para que el `fetch()` de los CSVs funcione (abrir el HTML
directo con `file://` no funciona por CORS del navegador):

```bash
# Opción 1: Python (ya viene instalado en casi todo)
python3 -m http.server 5500

# Opción 2: Node
npx serve .

# Opción 3: extensión "Live Server" de VS Code
```

Luego abre `http://localhost:5500`.

---

## Arquitectura

El proyecto está pensado como **estático + una sola función serverless**, sin
backend propio ni base de datos — a propósito, porque el alcance real del
problema (4 sucursales, 22 ingredientes, datos que se cargan una vez por
semana) no justifica mantener un servidor corriendo.

```
Navegador (HTML/CSS/JS puro)
  │
  ├─ Papa Parse → lee los 4 CSVs de /data al cargar la página
  │
  ├─ js/data-engine.js  → TODA la lógica de negocio vive acá, aislada de la UI:
  │     proyección de consumo, conversión de unidades, generación de alertas,
  │     detección de anomalías, agrupación por proveedor. No toca el DOM.
  │
  ├─ js/app.js  → renderizado de la interfaz + eventos. Le pide los números
  │     ya calculados a data-engine.js y solo se encarga de pintar tarjetas,
  │     tablas, gráficos (Chart.js), exports (SheetJS, jsPDF) y de manejar los
  │     inputs editables (recalcula todo en vivo, sin recargar la página).
  │
  └─ Chat (módulo "Asistente IA") → arma un resumen ya calculado
        (DataEngine.resumenParaChat) y lo manda por fetch() a...
              │
              ▼
        api/chat.mjs  (función serverless de Vercel, corre en el servidor)
              │
              ├─ Es la única pieza que no corre en el navegador — así la
              │   API key de Groq nunca queda expuesta en el cliente.
              ├─ Arma el system prompt (instrucciones + manual del dashboard
              │   + el resumen de datos) y llama a la API de Groq.
              └─ Devuelve la respuesta en texto plano al navegador.
```

**Por qué separar `data-engine.js` de `app.js`**: la lógica de negocio (¿esto
es una alerta crítica o no? ¿cuánto hay que pedirle a cada proveedor?) es la
parte que de verdad importa que esté bien probada y sea fácil de leer sin
ruido de DOM. Esa separación también es la que permite reutilizar exactamente
los mismos cálculos en 5 lugares distintos sin duplicar lógica: las tarjetas
de alerta, la tabla de "Órdenes", el Excel, el PDF y el resumen que recibe el
chat, todos llaman a las mismas funciones de `data-engine.js` — así nunca
quedan desalineados entre sí (por ejemplo, la "acción sugerida" de una alerta
es exactamente la misma línea de texto en la tarjeta, en el PDF y en lo que
lee el chat, porque sale de una sola función: `accionSugerida()`).

**Por qué el chat necesita su propia función serverless** y no llama a Groq
directo desde el navegador: cualquier API key puesta en JS del lado del
cliente queda visible para cualquiera que abra las herramientas de
desarrollador — así que `api/chat.mjs` corre del lado del servidor
específicamente para que `GROQAPIKEY` nunca viaje al navegador. El resto del
dashboard no necesita esto porque no llama a ninguna API externa con
credenciales — todo lo demás (CSVs, cálculos, exports) corre 100% en el
cliente.

**Por qué el chat recibe un resumen ya calculado y no los CSVs crudos**: si
le mandáramos las ~528 filas de consumo histórico sin procesar, el modelo
tendría que sumar y promediar él mismo para responder — y ahí es exactamente
donde un LLM falla más (aritmética sobre muchos números). En cambio,
`resumenParaChat()` arma un JSON compacto con los cálculos que
`data-engine.js` ya hizo y verificó — el modelo solo tiene que leerlos y
redactar la respuesta, nunca calcular nada.

**Por qué el dashboard está separado en módulos** (Resumen, Sucursales,
Proveedores, Informes, Anomalías, Asistente IA) en vez de una sola pantalla:
el volumen de datos es alto — hasta 88 combinaciones sucursal-ingrediente por
semana — y mostrarlo todo junto le habría quitado usabilidad a quien
realmente usa esto día a día. Cada módulo responde una pregunta distinta en
un momento distinto del proceso de la gerente:
- **Resumen** — "¿hay algo crítico ahora mismo?" (KPIs, semáforo, urgencias,
  sin tener que entrar sucursal por sucursal).
- **Sucursales** — el trabajo pesado de revisar y corregir pedidos; necesita
  su propio espacio porque es donde se pasa más tiempo.
- **Proveedores** — "¿a quién le compro y cuánto?", una pregunta distinta a
  "¿qué le pasa a esta sucursal?", así que vive aparte.
- **Anomalías** — compara una sucursal contra el promedio de las otras 3, una
  lógica distinta a la de Sucursales (que compara cada sucursal contra su
  propia proyección) — mezclarlas hubiera confundido ambas comparaciones.
- **Informes** — centraliza todas las exportaciones en un solo lugar, para no
  tener que buscar el botón de descarga módulo por módulo.

La idea general fue que cada pantalla resuelva una sola pregunta, para que el
dashboard no se sienta como una hoja de cálculo con botones encima.

> ⚠️ El chat con IA (`/api/chat`) es una función serverless de Vercel y **no
> funciona en este modo local simple** — necesitas `vercel dev` (ver abajo) o
> publicarlo en Vercel. El resto del dashboard (alertas, tabla, proveedores,
> anomalías) funciona igual en local.

## Cómo publicarlo en Vercel (gratis)

1. Sube esta carpeta a un repo de GitHub.
2. Entra a [vercel.com](https://vercel.com), conecta tu GitHub, importa el repo.
3. En **Settings → Environment Variables**, agrega:
   - `GROQAPIKEY` = tu API key gratuita de [Groq Console](https://console.groq.com) (sin tarjeta de crédito)
4. Deploy. Vercel detecta `api/chat.mjs` automáticamente como función serverless.
5. Prueba el link en una ventana de incógnito antes de entregarlo.

Para probar la función localmente antes de subir: `npx vercel dev` (requiere
`vercel login` y tener el proyecto linkeado con `vercel link`).

---

## Qué hace el dashboard

### 1. Proyección de consumo (4 métodos, todos visibles y seleccionables)

- **Promedio simple**: media de las 6 semanas de histórico.
- **Regresión lineal**: ajusta una recta a las 6 semanas y proyecta el punto 7,
  así que capta tendencias de crecimiento o caída (ej. una sucursal que está
  vendiendo más cada semana).
- **Robusta (sin atípicos)**: usa el rango intercuartílico (IQR) para descartar
  semanas anómalas (ej. una semana de evento especial) antes de promediar.
- **Recomendada (combinada)**: promedio entre regresión y robusta — busca
  capturar tendencia sin dejarse llevar por una semana rara. **Es el método
  que usamos por defecto para las alertas**, pero cualquiera de los 4 se
  puede seleccionar desde la interfaz y todas las alertas se recalculan al
  instante.

### 2. Conversión de unidades

Cada ingrediente en `ingredientes.csv` tiene `unidad_base_por_formato` (ej. un
"Saco 25 kg" de harina = factor 25). La orden de compra (`cantidad_formatos`) se
convierte a unidad base multiplicando por ese factor, para poder compararla
contra el consumo proyectado y el inventario (que ya vienen en unidad base).

### 3. Tolerancia de redondeo

Como no se puede comprar medio saco, cualquier diferencia **menor a 1 formato
completo** (en unidad base) se considera redondeo normal, no una alerta.

### 4. Tipos de alerta que genera

| Tipo | Cuándo se dispara |
|---|---|
| 🔴 **Riesgo de quiebre** | El pedido (convertido) es menor a la necesidad proyectada por más de 1 formato |
| 🟠 **Sobre-pedido** | El pedido supera la necesidad proyectada por más de 1 formato (se marca aparte si es perecedero, por el riesgo de que se venza) |
| 🔴 **Posible olvido** | La sucursal consume normalmente ese ingrediente (histórico > 0) pero no aparece en la orden de esta semana |
| ⚪ **No catalogado** | El ingrediente pedido no existe en `ingredientes.csv` — no se puede convertir ni evaluar (caso real en los datos: `aji_chombo` en Costa del Este) |

### 5. Extras que agregamos (todos incluidos)

- **Pedido corregido por proveedor**: agrupa, por proveedor, cuánto habría
  que comprar según la necesidad real proyectada (redondeada hacia arriba al
  formato completo) — listo para reenviar a cada proveedor.
- **Detección de sucursales atípicas**: para cada ingrediente, compara el
  ratio `pedido / proyección` de cada sucursal contra el promedio de las
  otras 3. Si una sucursal se desvía fuerte (z-score ≥ 1.4), se marca como
  atípica — esto detecta patrones raros que **no violan la tolerancia de
  redondeo individual** pero sí destacan frente al comportamiento del resto
  de la cadena.
- **Edición en vivo**: la tabla de "Orden de la semana" tiene inputs
  editables — cambia una cantidad y las alertas, KPIs y proveedores se
  recalculan al instante, sin recargar la página. Es el primer paso hacia la
  visión de "cargar todas las órdenes y ver las alertas al instante".
- **Chat con los datos**: cuadro de texto conectado a Groq
  (`llama-3.3-70b-versatile`, vía una función serverless que protege la API
  key), usando el tier gratuito de Groq (14,400 requests/día, sin tarjeta de
  crédito). El modelo recibe un **resumen ya calculado** de las alertas (no
  los CSVs crudos) — así responde rápido y sin inventar números que no
  calculamos nosotros mismos.
- **Gráfico de tendencia por ingrediente**: clic en cualquier fila de la tabla
  "Órdenes" (con Chart.js) abre un modal con las 6 semanas de consumo real, el
  punto de proyección recomendado, y una línea de referencia con el stock
  actual — así se *ve* por qué el sistema proyectó lo que proyectó.
- **Acción sugerida en cada alerta**: cada alerta no solo dice *qué* está mal
  (`js/data-engine.js → accionSugerida()`), sino qué hacer al respecto —
  cuántos formatos más pedir, si conviene bajar la cantidad, o verificar un
  ingrediente no catalogado. Se calcula una sola vez en el motor y se reutiliza
  en las tarjetas, la tabla, el Excel y el PDF, para que nunca queden
  desalineados.
- **Todas las exportaciones de Informes son Excel, no CSV**: cada pestaña
  (General, Ajustes de la gerente, Todos los pedidos, Historial de consumo)
  descarga un `.xlsx` con el ancho de columna ajustado automáticamente al
  contenido más largo de cada columna — a diferencia de CSV, que en Excel
  requiere autoajustar las columnas a mano o el texto largo se ve "comido"
  por la celda de al lado.
- **Exportación a Excel multi-hoja** (SheetJS), en la pestaña General: un
  `.xlsx` con una hoja de resumen, una hoja con todas las alertas
  (motivo + acción sugerida), y **una hoja por proveedor** — lista para
  reenviar sin editar nada.
- **Exportación a PDF por proveedor** (jsPDF + autoTable): genera un PDF con
  la identidad visual de Barrio Pizza (un bloque encabezado por proveedor),
  listo para imprimir o mandar por WhatsApp/email sin depender de la función
  "Guardar como PDF" del navegador.
- **Barra de resumen compacta**: chips de un vistazo (correctas / sobre-pedido
  / sin stock / olvidos / no catalogados) arriba del módulo Resumen, con los
  mismos números que las tarjetas KPI de abajo — pensado para el primer
  segundo de atención de la gerente.

---

## Supuestos que hicimos

1. **"Consumo proyectado" = punto 7 de la serie de 6 semanas**, no un
   promedio móvil de varias semanas futuras — el reto pide proyectar "la
   próxima semana", así que asumimos una sola semana hacia adelante.
2. **Ingredientes con histórico de consumo = 0 en las 6 semanas** no generan
   alerta de "olvido" aunque no estén en la orden (asumimos que la sucursal
   simplemente no los usa, no que se olvidó).
3. **La tolerancia de redondeo se aplica en unidad base**, no en formatos,
   para que sea proporcional al tamaño real del formato de cada ingrediente
   (1 saco de 25kg de harina ≠ 1 bolsa de 250g de albahaca).
4. **Ingredientes no catalogados no se incluyen en la comparación de
   anomalías entre sucursales** (no hay factor de conversión para
   normalizarlos).
5. **El "pedido corregido por proveedor" solo lista ingredientes con
   necesidad positiva** (no lista los que ya están cubiertos por inventario).

---

## Cómo usé IA para resolver esto

Usé **Claude** (Anthropic) durante todo el desarrollo:

- Para **explorar y entender los 4 CSVs** antes de escribir una sola línea de
  código — detectó automáticamente los dos casos "trampa" de los datos
  (el ingrediente no catalogado `aji_chombo` y el olvido real de mozzarella
  en Brisas del Golf) mediante un script de exploración en Python/Node antes
  de diseñar la lógica.
- Para **diseñar la arquitectura** completa (estático + función serverless
  para no exponer la API key en el navegador) antes de escribir código,
  discutiendo trade-offs conmigo.
- Para **escribir el motor de cálculo** (`js/data-engine.js`): proyecciones,
  conversión de unidades, generación de alertas, detección de anomalías.
- Para **verificar la lógica con datos reales** antes de entregar: corrí un
  script de prueba en Node que replica las funciones clave contra los CSVs
  reales y confirmé que los números tienen sentido (4 alertas críticas, 5 de
  sobre-pedido, 1 no catalogado con el método de regresión).
- Para **integrar el chat con la API de Groq** (`llama-3.3-70b-versatile`,
  elegido por su tier gratuito sin tarjeta de crédito — relevante porque esta
  herramienta se usaría muchas veces por semana sin generar costo) y para
  ajustar el uso de tokens dentro de los límites de esa capa gratuita a
  medida que se probó con preguntas reales (por ejemplo, bajar `max_tokens`
  de la respuesta para dejar más margen de tokens-por-minuto).
- El diseño visual (paleta, tipografía, layout) está **inspirado en la
  identidad de marca de Barrio Pizza** (mismo rojo `#CF2F2C` y negro
  `#231F20` de su sitio web), pero usando fuentes de Google Fonts libres de
  licencia (Anton, Inter, JetBrains Mono) en vez de sus tipografías
  propietarias.

---

## Cómo lo conectaría a un sistema como Odoo en producción

1. **Reemplazar los CSVs por los modelos de Odoo vía su API REST/XML-RPC**:
   - `ingredientes.csv` → `product.product` (con un campo custom para el
     factor de conversión formato↔unidad base, o usando las Unidades de
     Medida nativas de Odoo con factores de conversión).
   - `consumo_historico.csv` → se derivaría de los movimientos de inventario
     (`stock.move`) filtrados por consumo/salida, agregados por semana.
   - `inventario_actual.csv` → `stock.quant` (nivel de stock en tiempo real
     por ubicación/sucursal).
   - `orden_compra_semana.csv` → `purchase.order` / `purchase.order.line` en
     estado borrador, antes de confirmarse.
2. **El motor de cálculo (data-engine.js) se movería a un backend** (o a un
   módulo custom de Odoo en Python) que corra como un job programado cada
   vez que una sucursal guarda su borrador de orden, y escriba las alertas
   como mensajes en el chatter de la orden de compra o como un campo
   calculado visible antes de aprobarla.
3. **El dashboard se integraría como una vista embebida** (iframe o módulo
   nativo de Odoo) dentro del propio flujo de aprobación de compras, para
   que la gerente no tenga que salir de Odoo a revisar.
4. **El chat con IA** seguiría el mismo patrón (función/endpoint que arma un
   resumen de las alertas ya calculadas por Odoo y se lo pasa a Claude) —
   solo cambiaría de dónde saca los datos, no la arquitectura.

---

## Estructura del proyecto

```
├── index.html              # estructura del dashboard
├── css/style.css            # estilo visual (paleta/tipografía inspiradas en Barrio Pizza)
├── js/data-engine.js         # toda la lógica de negocio (proyección, alertas, anomalías)
├── js/app.js                 # renderizado de la interfaz y eventos
├── data/*.csv                 # los 4 archivos de datos
├── api/chat.mjs                # función serverless — chat con Groq (llama-3.3-70b-versatile)
├── package.json
└── vercel.json
```
