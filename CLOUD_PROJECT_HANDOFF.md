# Cloud-Projektübergabe: Tasks Sidebar

## Zweck

Dieses Repository entwickelt eine VS-Code-Erweiterung namens **Tasks Sidebar**. Die Erweiterung stellt die in `.vscode/tasks.json` definierten VS-Code-Tasks als visuelles Task-Board in einer eigenen Activity-Bar-Seitenleiste dar. Tasks können dort gestartet, gestoppt, neu gestartet, gefiltert, sortiert und hinsichtlich Laufzeit/Fortschritt beobachtet werden.

## Repository und Ausgangslage

- Repository: `https://github.com/ClemensSchmitt/tasks-sidebar.git`
- Lokaler Projektpfad: `C:\Users\cleme\OneDrive\Dokumente\ChatGPT\TasksSidebar`
- Aktiver Branch: `main`
- Remote: `origin/main`
- Letzter gemeinsamer Commit: `7fc76d7` (`Use Node 24 for release builds`)
- Letzter Release-Tag: `v0.0.5`
- Paketversion im aktuellen Arbeitsstand: `0.0.5`
- VS-Code-Mindestversion: `1.85.0`
- Extension-Host: `workspace`
- UI-Sprache: Englisch

Wichtig: Der Arbeitsstand ist **nicht sauber eingecheckt**. Die Änderungen gehören zum aktuellen Entwicklungsstand und dürfen nicht verworfen werden. Geändert sind:

- `.github/workflows/release.yml`
- `.vscodeignore`
- `README.md`
- `package.json` und `package-lock.json`
- `resources/tasks.svg`
- `src/extension.ts`

Neu und noch nicht committed sind:

- `src/runtime.ts`
- `test/runtime.test.js`
- `test/integration/run.js`
- `test/integration/suite.js`
- `test/integration/workspace/.vscode/tasks.json`

## Aktueller Funktionsumfang

- Task-Board als Webview unter dem Activity-Bar-Icon „Tasks“.
- Tasks über die offizielle VS-Code-API `vscode.tasks.fetchTasks()`.
- Standardmäßig nur Workspace-Tasks aus `.vscode/tasks.json`.
- Externe Provider wie npm, User-, Extension- oder andere Provider sind über `Tasks: Toggle external task providers` bzw. `tasksSidebar.includeExternalTasks` zuschaltbar.
- Starten, Stoppen und sicherer Neustart einzelner konkreter Task-Ausführungen.
- Sichtbare Zustände: laufend, stoppend, Warten auf Task-Ende, erfolgreich, fehlgeschlagen, abgebrochen, unbekannt und veraltet/stale.
- Suche nach Task-Name, Provider, Gruppe und Workspace-Ordner.
- Filter: alle, laufend, fehlgeschlagen, abgeschlossen, unbekannt/stale und externe Tasks.
- Deterministische Sortierung nach Name, Status, Laufzeit oder Ordner.
- Öffnen von `tasks.json` und Erstellen eines einfachen Shell-Tasks über die Erweiterung.
- Öffnen der ausgewählten Task-Ausgabe und Fokussieren des aktiven Task-Terminals über VS-Code-Kommandos.
- Anzeige von Version, Host und Provider.
- Keyboard-Fokus, Screenreader-Labels, ARIA-Fortschrittswerte, Reduced-Motion-Unterstützung und Forced-Colors-Hooks.
- Letzte gültige Task-Liste bleibt bei vielen Fehlern sichtbar; im Fehlerfall wird eine Retry-Möglichkeit angeboten.

## Architektur

### `src/extension.ts`

Hauptdatei der VS-Code-Erweiterung.

- `activate()` prüft die VS-Code-Version, registriert View, Kommandos und Task-/Workspace-Events.
- `TaskBoard` verwaltet Task-Discovery, aktive Ausführungen, Lifecycle, Stop/Restart, Persistenz, Historie, Abhängigkeiten und Publishing an die Webview.
- `TaskBoardView` erzeugt die Webview, behandelt Nachrichten aus der UI und rendert Snapshots.
- Persistenz erfolgt über `workspaceState`.
- Persistierte Schlüssel:
  - `tasksSidebar.history`
  - `tasksSidebar.lastGoodSnapshots`
  - `tasksSidebar.activeObservations`

### `src/runtime.ts`

Neue, von VS Code unabhängige Runtime-Hilfslogik, damit kritische Zustandsübergänge separat testbar sind. Enthält unter anderem:

- Task-Lifecycle und Outcome-Auflösung.
- Behandlung der Reihenfolge von Process-End- und Task-End-Events.
- Stale-/Timeout-Entscheidungen.
- JSONC-Parsing für `tasks.json` inklusive Kommentaren und trailing commas.
- Provider-Fallback-Parsing.
- Such-, Filter- und Sortierlogik.
- Laufzeit-, Plan- und Fortschrittsberechnung.
- Persistenz-/Reload-Reconciliation.
- Task-Identitäten für laufende Ausführung und Historie.
- Abhängigkeitsauflösung für sequenzielle und parallele Dependencies.
- VS-Code-Kompatibilitätsprüfung.

### `test/`

- `runtime.test.js`: 41 Node-Tests für Zustandslogik, IDs, Historie, Fortschritt, Discovery, JSONC, Workspace-Wechsel, Reload und Dependencies.
- `integration/suite.js`: echter VS-Code-Extension-Host-Test für Aktivierung, Kommandos, `tasks.json`, Task-Ausführung und zentrale Webview-Accessibility-/Escaping-Verträge.
- `integration/workspace/.vscode/tasks.json`: Fixture mit einem langlebigen Process-Task.

## Wichtige fachliche Regeln

- Eine erfolgreiche Ausführung ist nur bei bestätigtem Process-Ende und Exit-Code `0` gültig.
- Ein Exit-Code ungleich `0` ist fehlgeschlagen.
- Fehlende End- oder Exit-Code-Information wird nicht als Erfolg gewertet, sondern als `unknown` bzw. `stale`.
- Ein bestätigter Stop wird als `cancelled` geführt.
- Background-/Watch-Tasks bleiben laufend; sie dürfen nicht fälschlich wegen eines normalen Timeouts stale werden.
- Bei verlorenen End-Events oder unbestätigtem Stop wird nach einem begrenzten Timeout `stale` angezeigt. Die Erweiterung behauptet nicht, dass ein Prozess beendet wurde, wenn VS Code das nicht bestätigt.
- Restart bedeutet Stop-then-Start. Wenn der alte Task noch stoppt, wartet der Neustart auf das Terminal-Event.
- Parent-/Child-Tasks werden getrennt dargestellt. Das Stoppen eines Parents beendet Children nicht implizit, weil VS Code die Compound-Orchestrierung besitzt.
- Sequenzielle Dependencies werden strikt in deklarierter Reihenfolge ausgewertet. Parallele Dependencies werden unabhängig aggregiert.
- Jede konkrete parallele Ausführung erhält eine eigene Runtime-ID und bleibt separat stoppbar.
- Die Laufzeit wird mit einer monotonen Uhr gemessen. Suspend/Resume zählt als verstrichene Wandzeit.
- Der Fortschrittsplan verwendet die letzte erfolgreiche, gemessene Laufzeit. Fehlgeschlagene, abgebrochene, unbekannte, stale und rehydrierte Ausführungen verändern den Plan nicht.
- Es werden höchstens 20 Laufzeit-Samples und 200 Historieneinträge behalten.
- Laufende Beobachtungen werden über Reload hinweg persistiert und mit den von VS Code noch gemeldeten Executions abgeglichen.
- Die sichtbare Task-Identität umfasst Provider, Namen, Scope, Workspace und Definition. Umbenennen oder Definitionsänderungen können eine alte laufende Ausführung als verwaist sichtbar lassen.
- Die Historienidentität ist separat: Eine reine Umbenennung behält den Plan, eine Verhaltensänderung startet eine neue Historie.

## Kommandos und Konfiguration

Registrierte Kommandos:

- `tasksSidebar.refresh` — Board aktualisieren
- `tasksSidebar.openTasksJson` — `tasks.json` öffnen
- `tasksSidebar.createTask` — einfachen Shell-Task anlegen
- `tasksSidebar.toggleExternalTasks` — externe Task-Provider umschalten

Konfiguration:

- `tasksSidebar.includeExternalTasks` — standardmäßig `false`

## Qualitätssicherung

Im aktuellen lokalen Stand erfolgreich ausgeführt:

```text
npm run check              erfolgreich
npm test                   erfolgreich, 41 Tests bestanden
npm run test:extension    erfolgreich, VS Code Stable 1.139.0 / Windows
```

Die CI in `.github/workflows/release.yml` prüft aktuell:

- Ubuntu, macOS und Windows.
- VS Code `1.85.0` und Stable.
- Type-Check, Runtime-Tests und Extension-Host-Tests.
- Bei `v*`-Tags wird nach erfolgreicher Kompatibilitätsprüfung ein VSIX gebaut und als GitHub Release veröffentlicht.

Die aktuelle lokale Umgebung hatte Node `v22.14.0` und npm `11.1.0`. Die CI-Konfiguration verwendet Node 20.

## Bekannte Einschränkungen und offene Punkte

- WSL, Dev Containers und Remote SSH sind Best Effort und nicht automatisiert zertifiziert.
- Manuelle Accessibility-Prüfung mit repräsentativen VS-Code-Themes und echter Assistive Technology steht noch aus; automatisierte Verträge für Fokus, ARIA, Reduced Motion und Forced Colors existieren.
- Die Oberfläche ist aktuell nur Englisch.
- VS-Code entscheidet bei Output-/Terminal-Kommandos selbst über das Ziel. Die Erweiterung bietet keine per Karte auswählbare Zuordnung von Child-Terminals bei Compound-Tasks.
- Ein Process-Task kann ohne fokussierbares Terminal sein.
- Der aktuelle Arbeitsstand ist noch nicht committed und die Paketversion ist noch `0.0.5`, obwohl seit dem letzten Tag umfangreiche Änderungen und Tests hinzugekommen sind.

## Empfohlene Fortsetzung im Cloud-Projekt

1. Arbeitsstand und untracked Dateien vollständig übernehmen; nichts auf den letzten Commit zurücksetzen.
2. `npm run check`, `npm test` und `npm run test:extension` erneut ausführen.
3. Den aktuellen Diff fachlich prüfen, insbesondere die Änderungen in `src/extension.ts` und die neue `src/runtime.ts`.
4. Die manuelle VS-Code-UI-/Accessibility-Prüfung durchführen.
5. Entscheiden, ob die Änderungen als neuer Commit/Release vorbereitet werden sollen; Version und Changelog sind noch nicht aktualisiert.
6. Vor einem Release die CI-Matrix und die VSIX-Erzeugung prüfen.

## Startprompt für die Cloud-Fortsetzung

> Du übernimmst das Repository `C:\Users\cleme\OneDrive\Dokumente\ChatGPT\TasksSidebar`, ein VS-Code-Projekt namens „Tasks Sidebar“. Es handelt sich um eine visuelle Task-Board-Erweiterung für `.vscode/tasks.json`. Der Branch ist `main`, der letzte gemeinsame Commit ist `7fc76d7`, Release-Tag `v0.0.5`. Der Arbeitsstand enthält absichtlich umfangreiche uncommitted Änderungen plus neue Dateien: `src/runtime.ts` und `test/`. Diese Änderungen nicht verwerfen. Lies zuerst `CLOUD_PROJECT_HANDOFF.md`, `README.md`, `src/extension.ts`, `src/runtime.ts` und die Tests. Prüfe danach mit `npm run check`, `npm test` und `npm run test:extension`. Ziel ist, die bestehende Runtime-/Lifecycle-/History-/Dependency-Logik sicher weiterzuentwickeln, ohne die konservative Semantik für unknown/stale/cancelled oder die getrennte Identität paralleler Ausführungen zu verschlechtern. Offene Themen sind vor allem manuelle Accessibility-Prüfung, Remote-Host-Validierung, englische-only UI sowie Release-/Versionsvorbereitung.

