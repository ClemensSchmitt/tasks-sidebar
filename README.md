# Tasks Sidebar

Eine kleine VS-Code-Extension, die die Tasks aus `.vscode/tasks.json` in einer visuellen Sidebar darstellt.

## Features

- Tasks direkt aus der Activity Bar starten und stoppen
- laufende Tasks mit animierter Progressbar
- „Plan“ basiert auf der letzten gemessenen Laufzeit des jeweiligen Tasks
- zeigt während einer Überschreitung die zusätzliche Zeit („länger als üblich“)
- Laufzeiten und Run Count bleiben im Workspace gespeichert
- `tasks.json` per Stift-Button oder View-Menü öffnen
- Refresh reagiert auf neue/gelöschte Tasks

## Woher kommen die Tasks?

Die Extension verwendet `vscode.tasks.fetchTasks()` und baut keine Mockup-Daten. Standardmäßig werden daraus aber nur Workspace-Tasks übernommen, die aus der `.vscode/tasks.json` des geöffneten Workspaces stammen:

- `.vscode/tasks.json` im geöffneten Workspace

Weitere Provider werden nicht automatisch angezeigt. Sie können bei Bedarf über den Command-Palette-Befehl `Tasks: Toggle external task providers` oder die Einstellung `tasksSidebar.includeExternalTasks` eingeblendet werden:

- User-Tasks
- Tasks anderer Extensions
- npm-Tasks aus `package.json` (daher z. B. `build` und `build - packages/...`)

Der angezeigte `source`-Wert zeigt, welcher Provider den Task geliefert hat. Wenn noch keine `.vscode/tasks.json` existiert, legt der Edit-Button eine editierbare Datei mit einem leeren Task-Array an.

## Entwicklung

```bash
npm install
npm run compile
```

Mit `F5` lässt sich die Extension im Extension Development Host starten. Die View erscheint als neues Tasks-Symbol in der Activity Bar.

Die Extension nutzt ausschließlich die offizielle `vscode.tasks`-API. Dadurch funktionieren auch Tasks aus Extensions und User-Tasks, nicht nur Tasks aus der Workspace-`tasks.json`.
