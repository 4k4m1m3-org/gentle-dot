# Voice Mode en Linux / Hyprland

La rosa mantiene un controlador independiente del panel. Usa el micrófono y Parakeet nativos, la conexión WebSocket y la conversación actuales, Piper configurado en `~/.gentle-dot/piper.json`, y `pw-play` en la salida predeterminada de PipeWire. No necesita claves de OpenAI para reconocimiento ni síntesis.

## Uso

- `gentle-dot --voice-toggle`: empieza a escuchar sin abrir ni enfocar el panel. Funciona también al arrancar; la solicitud espera la conexión del daemon y las suscripciones de voz.
- Repetir mientras escucha: termina y envía lo reconocido. Durante inicialización espera a que termine de preparar el micrófono.
- Repetir durante transcripción, respuesta o reproducción: cancela Voice Mode.
- `gentle-dot --voice-cancel`: cancela explícitamente sin enviar una captura pendiente; detiene síntesis y reproducción. Una pregunta ya enviada permanece en el historial y el trabajo del asistente continúa. Para detener herramientas usa los controles normales del panel; la voz no aborta acciones sensibles.
- `gentle-dot --toggle`: conserva su comportamiento de abrir/cerrar el panel.

El modo rechaza preguntas si el asistente está ocupado, pide aprobación o cambia la conversación durante la captura. Las aprobaciones mantienen su mecanismo normal; un aviso hablado pide abrir el panel. No hay palabra de activación ni escucha automática al iniciar sesión.

## Hyprland

En la configuración Lua existente, después del bloque de `omarchy`:

```lua
local voice_toggle = (os.getenv("HOME") or "") .. "/.local/bin/gentle-dot --voice-toggle"
if omarchy and omarchy.bind then
  omarchy.bind("SUPER + ALT + I", "Gentle Dot Voice Mode", voice_toggle)
else
  hl.bind("SUPER + ALT + I", hl.dsp.exec_cmd(voice_toggle))
end
```

Ejecuta `hyprctl reload`. Para paquetes de sistema usa `/usr/bin/gentle-dot`. Los ejemplos del repositorio están en `scripts/linux/hyprland/`. No cambies las reglas existentes de ventanas ni el atajo del panel.

## Configuración local

Archivo opcional `~/.gentle-dot/voice-mode.json`. Se relee en cada activación. Se rechazan claves desconocidas, tipos incorrectos y límites fuera de rango; una configuración inválida no bloquea la cancelación.

```json
{
  "enabled": true,
  "spokenReplies": true,
  "silenceMs": 1500,
  "maxCaptureMs": 30000,
  "initialWaitMs": 10000,
  "levelThreshold": 0.32,
  "responseTimeoutMs": 180000,
  "engine": "piper"
}
```

`silenceMs`: 500–5000; `maxCaptureMs`: 3000–30000; `initialWaitMs`: 1000–30000 y no mayor que la captura máxima; `levelThreshold`: 0.001–0.5, sobre el medidor nativo logarítmico; `responseTimeoutMs`: 10000–600000. El umbral predeterminado corresponde aproximadamente a −41 dBFS. En ambientes ruidosos puede necesitar ajuste. El temporizador de captura comienza después de inicializar el modelo, con una espera separada de preparación de 120 segundos.

`engine` admite solo `piper` y reutiliza `piper.json`. **Hyprland es quien registra el atajo**: para configurarlo, cambia la combinación y el argumento de la llamada en el bloque Lua y ejecuta `hyprctl reload`. El silencio del panel se comparte entre ventanas y detiene la reproducción. `spokenReplies: false` desactiva la salida solo para Voice Mode.

La respuesta se sintetiza al terminar el turno. Si supera el límite del protocolo se divide en solicitudes secuenciales después de completarse, sin truncarla ni reproducir deltas del modelo.

## Compilar y validar

```sh
pnpm typecheck
pnpm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
pnpm build
pnpm --filter @gentle-dot/desktop exec tauri build --no-bundle
```

Ejecutable: `apps/desktop/src-tauri/target/release/gentle-dot`.

La suite automatizada verifica estados, silencio, límites, inicialización lenta, cancelación de resultados tardíos, silencio del usuario, desconexión, aprobación, envío único, rechazo del daemon ocupado y síntesis local cancelable. Las pruebas con fixtures no acreditan micrófono, voz Daniela, animación ni foco reales.

Aceptación manual: con otra aplicación enfocada y panel cerrado, pulsar el atajo, esperar la rosa cian, decir una pregunta y guardar silencio. Debe oírse una respuesta, volver la rosa al reposo y aparecer una sola pregunta en el historial. Probar también segunda pulsación, cancelación, silencio inicial, desconexión, asistente ocupado y mute. La pulsación al hablar es periódica, no un análisis de amplitud de la salida. La detección del final usa nivel y silencio, no un clasificador semántico de voz.

## Reversión

La copia anterior a los cambios conserva el **árbol de trabajo local**, no solo HEAD: código en `source.tar.gz`, `local-changes.patch`, estado Git, ejecutable `gentle-dot`, `piper.json` y directorio `hypr/`. No uses `git reset`, `git checkout .` ni extraigas todo indiscriminadamente: perderías cambios posteriores.

1. Cierra Gentle Dot normalmente. Conserva cualquier trabajo posterior a esta implementación.
2. Restaura el ejecutable anterior en `~/.local/bin/gentle-dot` desde la copia.
3. Elimina únicamente el bloque añadido de Voice Mode de `~/.config/hypr/gentle-dot.lua` (o restaura `hypr-before-install.lua` si no hubo cambios posteriores); ejecuta `hyprctl reload`.
4. Para revertir el código, extrae `source.tar.gz` a un directorio temporal y restaura únicamente las rutas de esta implementación, comparándolas primero. Elimina únicamente los archivos nuevos de Voice Mode. **`packages/daemon/src/piper-local.ts` ya existía antes, aunque Git lo mostraba como no rastreado: debe restaurarse, no eliminarse.**
5. `piper.json`, la voz Daniela y los modelos no necesitan cambios. Retira `voice-mode.json` solo si lo creaste para esta función.

El informe de validación de esta ejecución y la ubicación persistente del respaldo se entregan por separado.
