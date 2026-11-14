# INVENTARIO

Auditoría de solo lectura del repo `crew-health-twin`, hecha el 14-nov-2026, contra el objetivo
descrito en el encargo y la matriz de `deep-research-report.md`. No se modificó ningún archivo
existente. Este documento es lo único nuevo.

## 1. Resumen

Lo que existe es una aplicación web estática: un cuerpo 3D por sistemas, un motor de reglas con
umbrales fijos, un simulador de sensores y un tablero. Corre entera en el navegador.

No existe nada de la capa de datos del objetivo: no hay base de datos, ni API, ni ingesta de
fuentes externas, ni motor estadístico, ni tabla de evidencia con procedencia.

La lógica actual es Detectar y Tratar; no hay paso de Verificar. Además, casi todos los
umbrales actuales son rangos clínicos terrestres fijos, que es justo lo que el reporte pide no
hacer donde NASA no publica un límite. Ese es el choque principal y está detallado en la
sección 5.

## 2. Línea base

| Comprobación | Resultado |
|---|---|
| `npm test` (Vitest) | 28 de 28 pruebas pasan (motor 16, simulador 7, clasificación del atlas 5) |
| `npx tsc --noEmit` | sin errores |
| `npm run build` | compila; `dist/` de sitio estático |
| Llamadas de red en `src/` | ninguna (`fetch`, WebSocket, almacenamiento local: cero usos) |
| Control de versiones | **el repo no está bajo git** |

Las pruebas existentes contienen 13 afirmaciones de estado (`caution`, `critical`) que salen de
los umbrales actuales. Cualquier cambio de umbral las afecta, así que no se tocan sin tu
confirmación.

## 3. Stack y convenciones detectadas

| Aspecto | Lo que hay |
|---|---|
| Lenguaje | TypeScript estricto, módulos ES. Scripts de herramientas en `.mjs` |
| Runtime y build | Node 24, Vite 8, Vitest 5. Sin framework de UI: DOM directo con un ayudante `h()` |
| 3D | three.js y three-mesh-bvh; modelo `public/models/body.glb` derivado de BodyParts3D |
| Backend, base de datos, API | no existen |
| Python | no se usa. En este PC hay Python 3.15.0 instalado |
| Capas | `src/domain` (reglas puras), que alimenta a `src/data` (store, reloj, fuentes), que alimenta a `src/scene` y `src/ui`. `src/main.ts` es el único que conoce todas |
| Catálogos como datos | objetos `Record<Id, Def>` en `src/domain/catalog/*.ts` |
| Identificadores | uniones de cadenas en camelCase: `IndicatorId`, `SystemId`, `EnvironmentId` |
| Estados | `'unknown' \| 'nominal' \| 'caution' \| 'critical'` |
| Lectura | `{ indicatorId, value, t, source }`; `t` en minutos de misión; `source` es `simulated`, `manual` o `sensor` |
| Punto de extensión de datos | interfaz `SensorSource` y `HealthStore.ingest()` |
| Herramientas | `tools/*.mjs`, reciben rutas por argumento, se exponen como scripts de npm |
| Pruebas | `tests/*.test.ts` |
| Idioma | interfaz, README y comentarios en inglés (lo exige el concurso para todo material enlazado) |
| Datos crudos | `assets-src/` fuera de git |

Seguiré estas convenciones tal cual.

## 4. Inventario

| Componente del objetivo | Estado | Ubicación | Acción |
|---|---|---|---|
| Reglas Detectar → Tratar → Verificar | parcial | `src/domain/engine/evaluate.ts` (detectar por bandas fijas), `guidance` en `src/domain/catalog/indicators.ts` (tratar), `src/domain/engine/triage.ts` (a quién escalar). No hay verificar. No es la matriz del reporte | extender |
| Tabla de evidencia con procedencia | falta | solo hay texto libre: `reference` en `indicators.ts`, `radiationReference` en `environments.ts`, y `risks[]` en `systems.ts`, que apuntan todos a la página general de riesgos del HRP | crear |
| Ingesta de radiación (SWPC, DONKI) | falta | la dosis es simulada en `src/data/sources/SimulatedSource.ts` | crear, sobre la interfaz `SensorSource` |
| Ingesta de MMASH | falta | – | crear |
| Ingesta de OSDR / I4 | falta | – | crear |
| Motor de baselines | falta | el simulador tiene valores base constantes por canal, no baselines estimados | crear |
| Detección de deriva | parcial | `trendPerDay()` en `evaluate.ts`: pendiente por mínimos cuadrados sobre 3 días y bandera `worsening` proyectando 2 días. Sin EWMA ni CUSUM, sin calibración. El umbral de "Steady" (3 % de la escala) en `src/ui/format.ts` es ad hoc | extender |
| Dosis acumulada | parcial | dosis acumulada simulada (tasa del entorno más ráfaga de escenario) en `SimulatedSource.ts`; tasa calculada en `src/scene/BodyViewport.ts`. Sin detección de SPE por flujo, sin presupuesto de misión | extender |
| Regla de CO₂ | falta | solo una frase en la guía de SpO₂ menciona el CO₂ de cabina | crear |
| Simulador | existe | `SimulatedSource.ts`, `scenarios.ts`, `MissionClock.ts`; semilla fija, 6 escenarios, 14 días de historia | reusar; extender con canal de CO₂ e inyección de anomalías |
| API | falta | no hay servidor. Solo acciones en proceso: `src/app/actions.ts` y `HealthStore` | crear |
| Tablero | existe (parcial frente al objetivo) | `src/ui/*`, `src/scene/*`: cuerpo 3D, lista de sistemas, veredicto, tarjetas con gráfica, guía y registro manual. Falta el paso Verificar, la procedencia en cada alerta y un panel de radiación en vivo | extender |
| METHODS.md | falta | `README.md` cubre arquitectura y límites, no métodos estadísticos | crear |
| reference_map | falta | – | crear |
| Tests | existe | `tests/engine.test.ts`, `tests/simulator.test.ts`, `tests/classify.test.ts` | reusar; añadir |
| Demo offline | parcial | la app ya corre sin red una vez instalada. No hay snapshots (no hay fuentes) ni un script único de demo | extender |

## 5. Choques entre lo existente y el reporte

No corregí ninguno. Cada fila propone el cambio mínimo.

| # | Qué hay hoy | Qué dice el reporte o el encargo | Cambio mínimo propuesto |
|---|---|---|---|
| C1 | 12 de 13 indicadores se clasifican con bandas fijas de rangos clínicos terrestres (FC 50–100, SpO₂ ≥ 95, glucosa 70–140, etc.) | Donde NASA no publica límite (NR), usar desviación frente al baseline individual y etiquetarlo "no es límite NASA". El reporte cita como error concreto asignar "SpO₂ amarillo 94 %" | Añadir a cada indicador un campo `thresholdKind` y, para los NR, clasificar por baseline individual. Las bandas actuales quedan como respaldo marcado "rango terrestre ilustrativo, no es límite NASA" mientras no haya baseline |
| C2 | `radiationDose`: bandas en 300 y 500 mSv, con la etiqueta "NASA-STD-3001 career limit of 600 mSv; bands at 50% and about 83%" | "mSv/d amarillo/rojo: NR". Usar dosis acumulada, tasa, detección de SPE y margen contra un presupuesto de misión configurable, NR por defecto | Las bandas 300/500 las inventé yo: quitarlas. Estado de radiación por detección de SPE y por margen contra presupuesto cuando el presupuesto esté configurado. Cambia el color del sistema de radiación y 1 prueba |
| C3 | El límite de 600 mSv no sale del reporte | El reporte solo dice que NASA-STD-3001 Vol. 1 fija límites de misión y carrera, sin cifra | Marcarlo "sin verificar" en `reference_map.csv` hasta comprobarlo en la fuente |
| C4 | Ejercicio y calorías llevan "(NASA)" en su referencia: "Illustrative target based on ISS practice … (NASA)", "(NASA nutrition guidance)" | Ningún umbral etiquetado como NASA salvo [V2 6004] y los criterios SANS. Reporte: NR universal, comparar con baseline individual | Quitar "NASA" de esas etiquetas y pasarlos a baseline individual |
| C5 | Sueño: banda fija ≥ 7 h y el texto "Station crews are scheduled 8.5 hours of sleep but average close to 6" | Standard Measures (n=19, 2.137 noches): 7,33 ± 1,16 h en vuelo frente a 7,87 ± 1,10 h antes. "No suponiendo que todo astronauta duerme seis horas" | Reemplazar el texto por el dato del reporte y evaluar contra baseline individual |
| C6 | No existe indicador de ppCO₂ | Único umbral ambiental oficial: [V2 6004], media de 1 h ≤ 3 mmHg | Crear el indicador y la regla dura, con procedencia `estandar_obligatorio` |
| C7 | SANS se mide con una nota subjetiva de 0 a 10 (`visionChange`) | Criterio clínico NASA: ΔTRT ≥ 20 μm indicación temprana; ≥ 55 μm y/o Frisén ≥ 1 clínicamente preocupante | Añadir indicador de ΔTRT por OCT con procedencia `criterio_clinico_NASA`. La nota subjetiva queda como síntoma, sin umbral NASA |
| C8 | Tres pasos de guía indican fármacos u oxígeno sin condición: "Take a fever reducer…", "Take anti-motion-sickness medication…", "Start supplemental oxygen…" (`indicators.ts`, líneas 143, 253 y 280) | Todo fármaco exige el flag "preautorizado en plan médico", apagado por defecto | Ocultar esos pasos salvo que el flag esté encendido y mostrar en su lugar "requiere plan médico preautorizado". Cambia lo que hoy se ve en pantalla |
| C9 | `triage.ts` tiene 4 niveles, pero son de escalamiento (nominal, autocuidado, oficial médico, consulta a tierra) | Los 4 niveles de autoridad del reporte son de tratamiento: acción ambiental reversible, contramedida no farmacológica preaprobada, fármaco prescrito en el plan, emergencia | Son ejes distintos. No renombrar el triage; añadir `authorityLevel` a cada acción de tratamiento |
| C10 | Ninguna alerta lleva `provenance_class` ni fuente | Criterio de aceptación: ninguna alerta sin procedencia y fuente | Toda regla referencia filas de evidencia; el tablero las muestra en cada alerta |
| C11 | No hay paso Verificar: una acción no deja rastro ni se comprueba su efecto | "Una intervención no debería cerrarse como exitosa por haber sido ejecutada" | Registrar intervención y cerrar solo con la métrica objetiva de la matriz |
| C12 | Escenario "Solar particle event": 320 mSv en 8 h | No hay fuente para esa magnitud | Marcarlo parámetro de simulación, no observado; o sustituirlo por un evento real reproducido desde un snapshot de GOES |
| C13 | Entornos: Marte superficie 0,67 mSv/d; estación 0,6 y Luna 1,37 no están en el reporte | Reporte: 1,84 tránsito y 0,7 superficie, como "ambiente observado, no umbral" | Etiquetarlos así y vincular cada cifra en `reference_map.csv` |
| C14 | `metabolic` (glucosa, calorías) no corresponde a ninguna fila de la matriz | La matriz tiene 10 condiciones | Conservarlo fuera de la matriz, marcado sin regla NASA |

### Afirmaciones ya escritas en el código que hay que re-vincular

Son mías, de la primera versión, y hoy no tienen URL ni DOI: pérdida ósea de 1–1,5 % al mes;
dos horas de ejercicio al día en la estación; 8,5 h programadas y 6 h reales de sueño;
600 mSv de límite de carrera; 0,5–0,7 mSv/día en la estación; las cifras de RAD, de Chang'E-4 y
los rangos de AHA, ADA y AASM. Van a `reference_map.csv` como "sin verificar" hasta
comprobarlas.

### Sobre el reporte

`deep-research-report.md` trae 114 marcadores de cita inválidos que apuntan a 97 referencias
distintas. Re-vincular las 97 es mucho trabajo manual; propongo empezar por las que sostienen
las 10 filas de la matriz y dejar el resto como "sin verificar".

## 6. Capas que no existen: propuesta de stack

Necesito tu confirmación antes de crear nada aquí.

**Recomendación: seguir en TypeScript y Node, sin Python.**

| Capa | Propuesta | Por qué |
|---|---|---|
| Motor estadístico | módulos puros en `src/domain/stats/`, probados con Vitest | corre en el navegador, así el tablero sigue funcionando sin servidor y sin red |
| Ingesta | scripts `tools/ingest/*.mjs` que guardan snapshots en `data/snapshots/<fuente>/` con URL, fecha y hash | misma convención que `tools/build-body-model.mjs` |
| Base de datos | SQLite con `node:sqlite`, que ya viene en Node 24. Migraciones en `tools/db/migrations/*.sql`. Se exporta a JSON estático para el tablero | cero dependencias nuevas; el sitio publicado sigue siendo estático |
| API | servidor pequeño con `node:http` sobre la misma base y el mismo motor: `/rules`, `/evidence`, `/state/{crew_id}`, `/radiation/now`, `/alerts`, `/verify` | una sola implementación de las reglas |

La alternativa es la opción por defecto del encargo, Python con FastAPI. Tiene mejores
librerías estadísticas, pero obliga a duplicar el motor de reglas en dos lenguajes o a que el
tablero dependa de un servidor alojado, cuando los jueces necesitan un enlace público que abra
sin instalar nada. Además Python 3.15 es muy reciente: habría que comprobar que numpy, scipy y
pandas se instalan.

## 7. Plan de cambios mínimos

Todo es aditivo salvo donde se indica.

| Bloque | Qué | Archivos nuevos | Archivos existentes que se tocan |
|---|---|---|---|
| 0 | Poner el repo bajo git y abrir rama `feat/evidence-engine` | `.git` | `.gitignore` (añadir `data/raw/`) |
| 1 | Matriz del reporte y evidencia con procedencia; `reference_map.csv`; base de datos | `data/matrix/rules.json`, `data/matrix/evidence.json`, `reference_map.csv`, `tools/db/migrations/001_init.sql`, `tools/db/build.mjs`, `src/domain/evidence/*`, `tests/evidence.test.ts` | `package.json` (scripts) |
| 2 | Detectar → Tratar → Verificar en el motor y el tablero: tipo de umbral, CO₂, ΔTRT, niveles de autoridad, flag de fármacos, verificación, procedencia en cada alerta | `src/domain/engine/verify.ts`, `src/domain/medicalPlan.ts`, `src/ui/ProvenanceBadge.ts`, pruebas | `types.ts`, `indicators.ts`, `SimulatedSource.ts`, `HealthStore.ts`, `IndicatorCard.ts`, `SidePanel.ts`, y las pruebas afectadas por C1, C2 y C8 |
| 3 | Radiación real: SWPC y DONKI con snapshots, detección de SPE, dosis y margen contra presupuesto | `tools/ingest/swpc.mjs`, `tools/ingest/donki.mjs`, `src/domain/radiation/*`, `src/data/sources/SwpcSource.ts`, panel de radiación | `main.ts` (conectar la fuente) |
| 4 | Motor estadístico: baseline empírico-bayesiano, EWMA, CUSUM, logístico de CO₂; MMASH y calibración | `src/domain/stats/*`, `tools/ingest/mmash.mjs`, `tools/validate/*.mjs`, `data/validation/*`, `METHODS.md` | `evaluate.ts` (usar baseline cuando exista) |
| 5 | OSDR / I4: cambios antes y después con intervalos creíbles | `tools/ingest/osdr.mjs`, `tools/validate/i4.mjs` | – |
| 6 | API y demo offline | `server/index.mjs`, `tools/demo-offline.mjs` | `package.json` (scripts) |

### Alcance frente al plazo

La entrega cierra el domingo 15-nov a las 23:59 y además faltan el video, la página del
proyecto y publicar. El alcance completo del encargo no cabe con holgura. Mi orden recomendado
es 0, 1, 2, 3 y 4, y dejar para el final lo que menos aporta a la demo:

- el bloque 5: I4 son 4 personas en un vuelo de 3 días, valida el pipeline pero no cambia lo
  que se ve;
- del bloque 4, las curvas de calibración y el análisis de sensibilidad;
- del bloque 6, el servidor de API: el tablero no lo necesita para funcionar.

## 8. Decisiones que necesito

1. **Stack** de las capas nuevas: TypeScript y Node (recomendado) o Python con FastAPI.
2. **Git**: crear el repo, hacer un primer commit con el estado actual y abrir la rama.
3. **C2, radiación**: confirmar que quito las bandas de 300 y 500 mSv. Cambia el color del
   sistema y una prueba.
4. **C1**: confirmar que las bandas terrestres quedan solo como respaldo etiquetado hasta que
   haya baseline. Puede cambiar hasta 13 afirmaciones en las pruebas.
5. **C8, fármacos**: confirmar que los tres pasos se ocultan tras el flag, apagado por defecto.
6. **Idioma**: el concurso exige inglés en todo lo enlazado. Propongo `METHODS.md` y el tablero
   en inglés, y dejar las claves de `provenance_class` tal como las diste, con etiquetas
   visibles en inglés. Este inventario está en español: habría que traducirlo o no publicarlo.
7. **Archivos del reporte**: `deep-research-report.md` y el `.docx` están en la raíz. Si se
   publica el repo quedan públicos, en español y con marcadores de cita rotos. No los moví.
   Propongo `docs/research/` o dejarlos fuera de git.
8. **DONKI** pide clave de api.nasa.gov. Puedo probar con `DEMO_KEY`, que tiene un límite
   bajo, o usar una tuya.
9. **Alcance**: si aceptas el recorte de la sección 7 o prefieres intentarlo todo.

## 9. Avance (14-nov-2026)

El plan se aprobó con el stack recomendado. El proyecto se llevó al repo del equipo,
`StoneOcean`, en la rama `feat/evidence-engine`; las pruebas pasan igual que antes (28 de 28).

### Paso 0: prueba de humo de las fuentes

Se corre con `npm run sources:smoke`. Guarda cada respuesta en `data/snapshots/` con un
manifiesto (URL, fecha y SHA-256).

| Fuente | Resultado | Formato | Latencia | Límite anunciado |
|---|---|---|---|---|
| SWPC, protones integrales GOES (6 h, 1, 3 y 7 días) | funciona | JSON; 8 canales de energía, GOES-18, un dato cada 5 min | 90 a 1.000 ms | ninguno |
| SWPC, protones diferenciales (1 día) | funciona | JSON, con canal y `yaw_flip` | 111 ms | ninguno |
| SWPC, escalas NOAA actuales y página de definición | funciona | JSON y HTML | 68 y 1.623 ms | ninguno |
| DONKI SEP por api.nasa.gov con `DEMO_KEY` | funciona | JSON; 27 eventos de mayo y junio de 2024 | 908 ms | 10; quedaban 3 |
| DONKI por CCMC sin clave | falla: no conecta | – | – | – |
| OSDR, lista de archivos de OSD-569, 570, 571 y 575 | funciona | JSON | 170 a 530 ms | ninguno |
| OSDR, metadatos del estudio y API biodata | funciona | JSON y CSV | 140 a 740 ms | ninguno |
| MMASH en PhysioNet y en S3 | funciona | índice HTML y listado XML; `MMASH.zip` pesa 24,6 MB | 100 a 490 ms | ninguno |
| NTRS, búsqueda por POST | funciona | JSON | 966 ms | 500; quedaban 499 |

Dos hallazgos que afectan al bloque 3:

- El flujo de protones de hoy es de calma (0,17 a 0,48 pfu en ≥ 10 MeV, escala S0) y SWPC solo
  sirve los últimos 7 días. Para mostrar un evento real hace falta un archivo histórico.
- `DEMO_KEY` se agota enseguida. Para usar DONKI con regularidad hace falta una clave propia de
  api.nasa.gov, que es gratuita.

### Bloque 1: matriz, evidencia y referencias

| Entregable | Dónde | Estado |
|---|---|---|
| Las 10 reglas Detectar → Tratar → Verificar | `data/matrix/rules.json` | hecho |
| 32 afirmaciones de evidencia con procedencia, n, efecto, IC 95 % y p | `data/matrix/evidence.json` | hecho |
| 26 fuentes con URL o DOI comprobado | `data/matrix/sources.json`, `sources.resolved.json` | hecho |
| `reference_map.csv` | raíz; se regenera con `npm run refs:verify` | hecho |
| Base de datos SQLite con las 8 tablas | `tools/db/`, `npm run db:build` | hecho |
| Tipos y catálogo para la app | `src/domain/evidence/` | hecho |
| Pruebas | `tests/evidence.test.ts` (16) | hecho |

Estado de las 32 afirmaciones en `reference_map.csv`: 6 con la cifra hallada en el resumen de
la fuente, 26 con la fuente localizada pero la cifra sin comprobar (puede estar en el texto
completo) y ninguna sin fuente. "Fuente localizada" no significa "cifra comprobada".

Los choques de la sección 5 siguen sin tocar: se resuelven en el bloque 2.

### Bloque 2: Detectar → Tratar → Verificar (14-nov-2026)

Estado de cada choque de la sección 5:

| # | Estado | Qué se hizo |
|---|---|---|
| C1 | parcial | Cada indicador declara la base de su umbral y el tablero la muestra. Los 11 que no tienen límite NASA siguen usando el rango terrestre, ahora etiquetado "Illustrative terrestrial range · not a NASA limit". Clasificar por baseline individual queda para el bloque 4 |
| C2 | resuelto | Se quitaron las bandas de 300 y 500 mSv. La dosis se compara con un presupuesto de misión, sin configurar por defecto. Un evento solar se juzga por el flujo de protones en la escala S de NOAA |
| C3 | resuelto | La app ya no afirma el límite de 600 mSv |
| C4 | resuelto | Ejercicio y calorías ya no mencionan a NASA como origen del rango |
| C5 | resuelto | El texto de sueño usa el dato de Standard Measures (7,33 h frente a 7,87 h) |
| C6 | resuelto | Indicador `ppCO2` con el estándar [V2 6004]: sobre 3 mmHg es precaución; nunca crítico mientras el programa no fije su límite |
| C7 | resuelto | Indicador `retinalThickness` con los criterios SANS de 20 y 55 μm |
| C8 | resuelto | Los pasos con fármacos se ocultan salvo que el plan médico los preautorice; el interruptor está apagado por defecto |
| C9 | resuelto | Cada paso del protocolo lleva su nivel de autoridad (1 a 4). El triage no se renombró |
| C10 | resuelto | Toda alerta muestra la base del umbral, la clase de procedencia y la fuente |
| C11 | resuelto | Una intervención queda pendiente hasta que el indicador se mide de vuelta en rango; si no ocurre en la ventana, queda "no verificada" |
| C12 | parcial | El escenario solar se rotula como parámetros de simulación. Reproducir un evento real queda para el bloque 3 |
| C13 | parcial | Las tasas de radiación se rotulan "observed environment, not an alert threshold". Faltan en `reference_map.csv` las de la estación y la Luna |
| C14 | resuelto | Se añadió la regla `R-NUTRITION`, marcada como añadida por el proyecto y no por el reporte, para que glucosa y calorías tengan procedencia |

Decisiones que tomé y conviene que revises:

- **Regla añadida.** `R-NUTRITION` no está en el reporte. Sin ella, dos indicadores podían
  alertar sin procedencia. No inventa umbrales y está marcada `origin: project`.
- **Escala S de NOAA.** Es una escala operativa, no encaja en ninguna de las 7 clases de
  procedencia. El umbral se rotula "NOAA operational scale · not a NASA limit" y la alerta toma
  la procedencia de la regla de radiación.
- **Contramedidas en el simulador.** Al marcar un paso como hecho, el simulador hace que el
  indicador se recupere, para que Verificar tenga una respuesta que medir. Refugiarse no baja
  el flujo: reduce a la mitad la dosis del evento.
- **Ventana de verificación.** Tres ciclos de medición y nunca menos de 6 horas. Es un
  parámetro del proyecto, no una cifra de NASA.

Pruebas: 73 de 73.

### Bloque 3: radiación real (14-nov-2026)

Se hizo con valores por defecto, porque las dos preguntas abiertas (clave de api.nasa.gov y
evento histórico o sintético) no cambian el alcance.

| Entregable | Dónde | Estado |
|---|---|---|
| Ingesta de GOES (NOAA SWPC) y de eventos SEP (NASA DONKI), con respaldo al snapshot si la fuente no responde | `tools/ingest/space-weather.mjs`, `npm run ingest:space-weather` | hecho |
| Snapshot compacto incluido en la app, para funcionar sin red | `data/snapshots/space-weather.json` | hecho |
| "Radiación ahora": nivel S de NOAA y evento en curso solo si el alza es sostenida | `src/domain/radiation/spaceWeather.ts`, `spe.ts` | hecho |
| Carga en vivo con caída al snapshot | `src/data/spaceWeather.ts` | hecho |
| Tarjeta "Space weather now" en el resumen y en el sistema de radiación | `src/ui/SpaceWeatherCard.ts` | hecho |
| El flujo simulado parte del nivel real de calma medido por GOES | `SimulatedSource.setQuietFlux()` | hecho |
| Tasas de radiación de la Luna y de la estación en `reference_map.csv` | `data/matrix/` | hecho: la lunar con DOI comprobado; la de la estación queda `sin_verificar` y rotulada |

Lo que no se hizo:

- **Reproducir un evento solar real.** SWPC solo sirve 7 días y hoy el Sol está en calma (S0).
  El evento de la demo sigue siendo sintético y está rotulado. Un evento histórico exige el
  archivo de NCEI, en formato netCDF.
- **DONKI en vivo.** `DEMO_KEY` devuelve 429. La lista que se muestra es el snapshot de mayo y
  junio de 2024. Con una clave propia en la variable `NASA_API_KEY`, el script la actualiza.
- **Contraste con los protones diferenciales**, que pedía el encargo por el problema de calidad
  de 2024. El snapshot diferencial está guardado, pero no se compara.
- **Dosis a partir del flujo.** No hay un modelo validado para convertir flujo en dosis, así que
  no se calcula.
- **El endpoint `/radiation/now`.** La función existe (`radiationNow`); el servidor es del
  bloque 6.

Estado de `reference_map.csv`: 35 afirmaciones; 6 con la cifra hallada en el resumen, 28 con
la fuente localizada y 1 sin verificar (la tasa de la estación), que no respalda ninguna alerta.

Pruebas: 85 de 85.

### Bloque 4a: motor estadístico y validación (14-nov-2026)

| Entregable | Dónde | Estado |
|---|---|---|
| Baseline individual con encogimiento empírico-bayesiano (normal-normal) e intervalos predictivos | `src/domain/stats/baseline.ts` | hecho |
| Deriva con EWMA y CUSUM | `src/domain/stats/drift.ts` | hecho |
| CO₂: regla dura y modelo logístico con prior OR ≈ 2 por mmHg | `src/domain/stats/co2.ts` | hecho |
| Calibración de límites para una tasa de falsas alarmas objetivo | `tools/validate/calibrate-drift.mjs` | hecho |
| Inyección de anomalías y análisis de sensibilidad | `tools/validate/inject-anomalies.mjs` | hecho |
| Ingesta de MMASH y validación con datos reales | `tools/ingest/mmash.mjs`, `tools/validate/mmash.mjs` | hecho |
| `METHODS.md` con supuestos, fórmulas, resultados y limitaciones | raíz | hecho |
| Clasificar los 11 indicadores por baseline individual dentro de la app | `src/domain/engine/monitor.ts` | hecho en el bloque 4b |
| Cambios antes y después de I4 con intervalos creíbles | – | pendiente (bloque 5) |

Hallazgos que cambian el diseño:

- **Los límites "de libro" no sirven con un baseline corto.** Con el límite para una falsa
  alarma cada 100 lecturas y un baseline estimado con 14 lecturas, la probabilidad de al menos
  una falsa alarma en 30 días es de 0,50. Recalibré los límites en la condición real de uso:
  0,034 en 30 días para precaución y 0,004 para crítico.
- **El precio es detectar tarde las derivas pequeñas.** Con esos límites, una deriva de 1
  desviación estándar se detecta en una semana solo el 10 % de las veces; una de 3, el 97 %.
- **Los datos reales no son independientes.** En la frecuencia cardiaca nocturna de MMASH las
  falsas alarmas duplican la tasa nominal (autocorrelación de 0,51).
- **El encogimiento ayuda cuando hay pocas lecturas.** Con una sola lectura, el error al
  predecir el nivel de una persona baja 56 %; con ocho, 10 %. Los intervalos predictivos
  quedan bien calibrados (95 % nominal, 95,8 % observado).
- **El respaldo con sueño es moderado.** La correlación con el tiempo despierto reportado es
  de 0,68 (IC 95 %: 0,22 a 0,91); con el número de despertares es de 0,40 y su intervalo
  incluye el cero.

`MMASH.zip` (24,6 MB) se descargó de PhysioNet y se verificó contra la suma SHA-256
publicada. Está en `data/raw/`, fuera de git. El archivo derivado que sí se publica (60 KB)
queda bajo la misma licencia ODbL, con atribución.

Pruebas: 101 de 101.

### Bloque 6: API y demo offline (14-nov-2026)

Se adelantó al bloque 4b porque no depende de la decisión pendiente sobre el punto de
operación de los detectores.

| Entregable | Dónde | Estado |
|---|---|---|
| API con `/rules`, `/evidence`, `/state/{crew_id}`, `/radiation/now`, `/alerts` y `/verify` | `src/api/handlers.ts`, `src/api/runtime.ts`, `server/index.mjs`; `npm run api` | hecho |
| La API usa el mismo motor de reglas que el tablero (se carga con Vite, no hay segunda implementación) | `server/index.mjs` | hecho |
| Alertas, intervenciones y verificaciones se guardan en SQLite | `server/index.mjs` | hecho |
| Script de demo offline | `tools/demo-offline.mjs`; `npm run demo:offline`, `npm run demo:check` | hecho |

Endpoints adicionales que hicieron falta: `POST /measurements` (lectura manual),
`POST /simulate` (avanzar la misión o cambiar de escenario) y `PUT /medical-plan` (flag de
fármacos). `POST /verify` rechaza con 403 cualquier paso con fármacos mientras el plan médico
no los preautorice, aunque se declare con otro nivel de autoridad.

Qué comprueba `npm run demo:check`: que los 19 snapshots están en disco y coinciden con su
SHA-256; que los datos que la app incluye existen; que la base se construye desde la matriz;
que el sitio compila; que el único archivo del código que abre una conexión es
`src/data/spaceWeather.ts`, hacia SWPC y con caída al snapshot; y que, con la red bloqueada,
el motor y la API responden.

Límite de esa comprobación: bloquea la red dentro del proceso de Node. No se probó el tablero
en un navegador con el equipo desconectado.

La API es para uso local: no tiene autenticación y sigue a un solo tripulante (`crew-1`).

Pruebas: 115 de 115.

### Bloque 4b: baseline individual dentro de la app (14-nov-2026)

Punto de operación confirmado por el usuario: los límites recalibrados del bloque 4a.

| Entregable | Dónde | Estado |
|---|---|---|
| Monitoreo contra el baseline: valor por día de tripulación, baseline de 14 días que se ajusta una vez y queda congelado, EWMA, CUSUM y regla de valor único | `src/domain/engine/monitor.ts` (nuevo) | hecho |
| El motor usa el baseline cuando existe y el rango ilustrativo mientras no (parámetro opcional: las firmas anteriores siguen sirviendo) | `src/domain/engine/evaluate.ts`, `src/data/HealthStore.ts` | hecho |
| Verificar contra el baseline: se cierra cuando el valor vuelve al rango habitual de la persona (95 %), con ventana de 3 días | `src/domain/engine/verify.ts` | hecho |
| Etiqueta dinámica "Individual baseline · not a NASA limit" en tarjeta, resumen y API | `indicatorRules.ts`, `IndicatorCard.ts`, `SidePanel.ts`, `handlers.ts` | hecho |
| Tarjeta: baseline (media ± DE), valor actual en DE, las tres reglas con sus límites y cuál disparó; el gráfico usa las bandas del baseline | `src/ui/IndicatorCard.ts`, `src/ui/TrendChart.ts` | hecho |
| API: campo `baseline` en `/state/{crew_id}` y `/alerts` | `src/api/handlers.ts` | hecho |
| Regla de valor único calibrada con el mismo script y medida en la inyección de anomalías | `tools/validate/calibrate-drift.mjs`, `tools/validate/inject-anomalies.mjs` | hecho |

**C1 queda resuelto** para los 11 indicadores que ahora se juzgan contra el baseline. Eran
12 los que usaban rango terrestre, no 11 como decía el bloque 2: el puntaje de visión
(`visionChange`) sigue con su rango ilustrativo etiquetado, porque se mide cada 3 días y no
junta 14 valores. También se usa el rango ilustrativo mientras una persona no tenga 14 días
completos registrados.

Decisiones tomadas durante el bloque que conviene que revises:

1. **Añadí una tercera regla (valor único) que no estaba en lo aprobado.** Con solo EWMA y
   CUSUM, un valor extremo aislado podía quedar en "nominal": un salto de 6 desviaciones
   estándar el día 20 se marcaba ese mismo día solo el 26 % de las veces. Con la regla, el
   81 %. Los límites EWMA y CUSUM que aprobaste no cambiaron. El costo: la probabilidad de
   falsa alarma por indicador en 30 días pasa de 3,4 % a **3,8 %** (crítico: de 0,37 % a
   0,42 %), dentro del objetivo de 5 % y 0,5 %.
2. **En los sensores se compara la media de las últimas 24 horas**, no lo que va del día.
   La frecuencia cardiaca y la temperatura tienen ritmo día-noche, y media mañana parecía un
   cambio de 1,5 desviaciones que no existe. Consecuencia: un cambio brusco tarda horas en
   verse (la fiebre del escenario, 15 horas hasta precaución y 18 hasta crítico).
3. **Tras marcar un tratamiento, los detectores se reinician** y el estado anterior se
   mantiene hasta que haya un valor posterior (en sensores, 24 horas completas).
4. **La demo arranca con 15 días de historia** en vez de 14 (`HISTORY_DAYS`): 14 días
   completos para el baseline más el día que empieza.
5. **El simulador tiene ahora variación de un día a otro** en los sensores y más ruido en las
   medidas diarias. Sin eso, la media diaria salía irrealmente estable. Son parámetros
   ilustrativos, no mediciones de ninguna tripulación.

Tiempo hasta la primera alerta en los escenarios de la demo (semilla por defecto):

| Escenario | Indicador | Precaución | Crítico |
|---|---|---|---|
| Falla del equipo de ejercicio | ejercicio aeróbico / resistivo | 2 días / 4 días | 3 días / 4 días |
| Alteración del sueño | sueño | 3 días | 4 días |
| Alteración del sueño | frecuencia cardiaca | 27 h | 35 h |
| Reactivación viral | temperatura | 15 h | 18 h |
| Reactivación viral | SpO₂ | 29 h | 41 h |
| Signos de SANS | mareo | 1 día | 1 día |
| Ingesta insuficiente | glucosa / calorías | 4 días / 5 días | 4 días / 7 días |

Es más lento que con los rangos terrestres (el ejercicio antes pasaba a precaución en 2
días). Es el precio, ya medido en el bloque 4a, de tener pocas falsas alarmas con un
baseline de 14 días.

Pruebas que cambiaron de significado, porque el estado ya no sale de una banda fija:

- "starts with two weeks of history…": ahora espera 15 lecturas diarias y un baseline de 14 días.
- "turns bone and muscle from nominal to critical when exercise stops": un día bajo sigue
  nominal; a los 8 días es crítico (antes: precaución a los 2 días).
- "continues from a manually logged value" y "accepts a manual measurement…" (API): un ánimo
  de 3 ya no es crítico por definición; se marca como alejado del baseline, y un 1 es crítico.

Pruebas nuevas: 26 (`tests/monitor.test.ts`, más casos en simulador, verificación y API),
entre ellas 10 misiones sanas de 30 días para vigilar las falsas alarmas.

Comprobado en el navegador: escenario de reactivación viral en la estación; la temperatura
pasa a crítico con la etiqueta de baseline individual, se marca un paso, el estado se
mantiene mientras se espera un valor y la intervención queda verificada 32 horas después.
No comprobado en pantalla: los demás escenarios con el baseline y la vista en móvil.

Pruebas: 141 de 141.
