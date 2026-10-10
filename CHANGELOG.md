# Registro de cambios de ELA

Este documento resume los cambios del fork comunitario ELA. El código base y sus avisos originales pertenecen a Gentle Dot y a sus respectivos autores; consulta [Créditos y licencia](README.md#créditos-y-licencia).

## ELA v0.1.0 — candidato de lanzamiento

Primer candidato de desarrollo de **ELA — Local AI Desktop Assistant**, basado en [Gentle Dot](https://github.com/Gentleman-Programming/gentle-dot). Este candidato no se ha etiquetado ni publicado.

### Incluye

- Integración optativa con Ollama mediante su API compatible con OpenAI. Un modelo local instalado, como `qwen2.5:3b`, permite conversar sin una cuenta ni una API key comercial.
- Reconocimiento de voz local mediante Parakeet y síntesis mediante Piper.
- Voice Mode en segundo plano y atajos configurables en Hyprland.
- Voz Rápida para respuestas habladas: conserva la identidad de ELA y el historial reciente necesario, con un prompt compacto y sin herramientas de ejecución.
- Agente completo para el chat escrito, con herramientas y aprobaciones de seguridad existentes.
- Tema azul eléctrico, manteniendo la rosa y la identidad técnica compatible con Gentle Dot.
- Prueba manual de voz de extremo a extremo confirmada por el usuario: micrófono → Parakeet → Ollama → Piper → reproducción audible. No fue una prueba automatizada.

### Validación del candidato

- `pnpm typecheck`, `pnpm lint` (sin errores ni advertencias), `pnpm test`, compilación de interfaz y compilación de Tauri `--no-bundle`: aprobados.
- Suite TypeScript: 694 aprobadas y 6 omitidas. Pruebas Rust: 362 aprobadas y 2 omitidas porque requieren el modelo Parakeet real.
- Compilación del runtime y su self-check empaquetado: aprobados.
- Playwright E2E: un caso de cambio de conversación falla de forma reproducible porque el botón `Stop` permanece visible después del cambio; los otros 16 casos pasan con el entorno Ollama aislado. El candidato necesita resolver o aceptar expresamente esta incidencia antes de considerarse listo para publicar.

### Limitaciones conocidas

- ELA sigue en desarrollo y no garantiza compatibilidad con todas las distribuciones, escritorios, dispositivos o controladores Linux.
- Los modelos locales pequeños, incluido Qwen 2.5 3B, pueden fallar al usar herramientas, generar argumentos incorrectos o no conservar detalles semánticos entre turnos. El Agente completo conserva sus controles y aprobaciones.
- El rendimiento depende del hardware, el modelo, la solicitud y la caché. La Quadro P620 no fue utilizada por la compilación CUDA de Ollama probada.
- Captura de micrófono y salida audible dependen de los dispositivos y permisos de cada entorno; la validación real reportada fue manual.
- Algunas funciones nativas de control del escritorio del proyecto original están orientadas a macOS y pueden no estar disponibles en Linux.
- Las integraciones avanzadas con proyectos y LivePlay todavía no están implementadas.
- La calavera y la traducción completa al español son objetivos futuros; no forman parte de este candidato.

ELA es un fork independiente de Gentle Dot, no una versión oficial. Se conserva la licencia MIT y los avisos y créditos del proyecto original.
