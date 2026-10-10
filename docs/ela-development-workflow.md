# Flujo de desarrollo de ELA

El checkout principal de ELA vive en `/home/wbolivar/projects/4k4m1m3/gentle-dot` y trabaja sobre `ela`. El worktree `../gentle-dot-worktrees/main` es la base limpia del proyecto original. `origin` apunta al fork personal y `upstream` al repositorio de Gentleman Programming.

## Trabajo cotidiano

Trabaja en el checkout principal y confirma los cambios en `ela`. Antes de confirmar, revisa `git status`, `git diff --check`, el diff completo y que no haya secretos, archivos `.env`, bases de datos, modelos, `node_modules`, `target`, `dist` ni copias de respaldo. No uses `git add -A` sin revisar cada archivo.

## Funcionalidades nuevas

Para una función genérica, actualiza el worktree de `main` mediante fast-forward y crea un worktree de función desde `main`:

```sh
cd /home/wbolivar/projects/4k4m1m3/gentle-dot-worktrees/main
git fetch upstream
git merge --ff-only upstream/main
git worktree add ../gentle-dot-worktrees/nombre-funcion -b feature/nombre-funcion main
```

Para personalización exclusiva de ELA, parte de `ela` (por ejemplo `feature/ela-branding`). Prueba la función en su worktree y revisa sus dependencias. Integra los commits elegidos en `ela` con `git cherry-pick` o un merge explícito después de revisar el diff y ejecutar las pruebas. No actives una misma rama en dos worktrees.

## Sincronizar cambios oficiales

```sh
cd /home/wbolivar/projects/4k4m1m3/gentle-dot-worktrees/main
git fetch upstream
git merge --ff-only upstream/main
```

Si el fast-forward falla, detente y analiza la divergencia; no reescribas `main`. Luego integra `main` en `ela` de forma explícita:

```sh
cd /home/wbolivar/projects/4k4m1m3/gentle-dot
git merge main
```

Resuelve conflictos archivo por archivo, conservando el comportamiento y tema de ELA. Ejecuta typecheck, pruebas, build y `git diff --check` antes de continuar. Tras revisión, publica las ramas con push normal; nunca uses force-push.

## Contribuir al proyecto original

Las ramas genéricas deben basarse en `main`, no en `ela`. Antes de proponer un PR:

```sh
git diff --check main...feature/nombre-funcion
git log --oneline main..feature/nombre-funcion
git diff --stat main...feature/nombre-funcion
git diff main...feature/nombre-funcion
```

Comprueba que el diff solo contenga la función, sus pruebas y documentación; que no arrastre branding, Piper u otros commits personales; y que pase las pruebas relevantes. Si el cambio solo se puede extraer con dependencias, documenta la cadena de ramas y no lo presentes como independiente. Prepara el PR manualmente después de revisión. Si piden cambios, continúa en la misma rama.

## Recuperación de la migración

El respaldo verificable de esta migración está en `/home/wbolivar/.local/state/ela/migrations/migration-20261009-220707/`. Su manifiesto contiene tamaño, modo y SHA-256. Incluye el diff binario del repo antiguo, fuentes nuevas seleccionadas, estado Git, ejecutable anterior, destino del symlink, configuración activa de Hyprland y `piper.json`. El respaldo anterior `~/.local/state/gentle-dot/backups/gentle-dot-before-voice-20261009-184952` se conserva sin modificar. El historial completo de `~/.gentle-dot/` no forma parte de la copia.

Para recuperar el código migrado, aplica `repo/unstaged.patch` sobre el commit base indicado en `git-state.json` y restaura los archivos enumerados bajo `repo/untracked/` después de revisar el manifiesto. Para volver al binario anterior, apunta `~/.local/bin/gentle-dot` al destino registrado en `installed-gentle-dot-link.txt` o copia `installed-gentle-dot` conservando permisos. Para recuperar la configuración activa, compara primero los respaldos `hypr-gentle-dot.lua` y `piper.json`; restaura solo el archivo necesario y conserva permisos privados. El repo antiguo permanece como otra fuente de recuperación; este procedimiento no borra ni restablece ninguna rama.
