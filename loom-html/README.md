# Loom als HTML-Dokumentation

## Idee

Loom läuft weiter im Terminal. Parallel dazu entsteht pro Workspace eine Dokumentation, die man im Browser anschaut: immer gleicher Aufbau, optionale Teile nur wenn vorhanden, so viel wie möglich visualisiert, Screenshots inklusive. Die md-Dateien sind gut lesbar, solange ein Problem klein ist. Bei komplexen Runs werden sie unübersichtlich. Die HTML-Ansicht soll das lösen, ohne den Ablauf von loom zu ändern.

## Stand

Das Mockup zeigt einen echten Run (`ticktack/.loom/dashboard-refinement`) und nimmt dafür nur den Inhalt, den loom heute schon schreibt. Nichts ist dazuerfunden oder umformuliert. Das Template liest die md-Dateien ein und ändert nur die Darstellung.

So wird jede Datei dargestellt:

- `pipeline.md` erscheint nicht als Datei. Es steuert den Stepper oben (Status, Dauer, Fragerunden, Durchgänge pro Phase) und die Zeitleiste in der Übersicht. Die rohe Historie liegt zugeklappt unter "Lifecycle record".
- `develop-log.md` wird zu "Phase by phase": die Zusammenfassung, die jede Phase am Ende gemeldet hat.
- `seed.md` ist zugeklappt als "Original request". Seine erste Zeile ist der Seitentitel.
- `spec.md` wird zu den Tabs Intent und Stories. Stories haben EARS-Schlüsselwörter als eigene Spalte, dazu eine Matrix, welche Task welche Story baut.
- `decisions.md` wird zum Tab Decisions. Pro Frage stehen Antwort, Optionen mit Aufwand und Risiko, die empfohlene und die gewählte Option und die ASCII-Skizze. Das Briefing ist zugeklappt. Die Entscheide ohne Rückfrage (D1 bis D30) stehen als aufklappbare Liste darunter.
- `design.md` hat eine Gliederung links. Die Architekturentscheide sind Karten mit dem Entscheid sichtbar und Kontext, Begründung und Alternativen zugeklappt.
- `plan.md` zeigt einen Task-Graphen, berechnet aus den blocked-by-Angaben. Jede Task hat Felder, Evidenz und Testzahlen rot nach grün als kleine Balken.
- `build-report.md` zeigt Smoke-Checks mit Status und die Screenshots als Galerie, beschriftet aus dem Report.
- `review.md` und die archivierten Reviews unter `superseded/` werden zu Durchgängen (Pass 1, Pass 2) mit Urteil und Findings.

Überall gilt: IDs wie Q4, D29, US-012, ADR-07, T-012 oder F-2 sind Links zur Stelle, wo sie definiert sind. RETURN-Blöcke für den Orchestrator sind ausgeblendet.

## Was der heutige Output nicht hergibt

- Kein abstraktes Bild des Problems. Dafür müsste loom zusätzlichen Inhalt schreiben.
- Diagramme gibt es nur als ASCII. Sie werden unverändert gezeigt.
- Fragerunden sind nicht pro Frage festgehalten, nur im Einleitungstext von `decisions.md`.
- Die Phasendauer enthält die Wartezeit auf Antworten. `pipeline.md` trennt Arbeit und Warten nicht.
- Superseded `design.md` und `plan.md` werden noch nicht gezeigt, nur superseded Reviews.
- Es gibt keinen Ort für Bemerkungen ausserhalb der Phasen, also Dinge, die nebenbei im Chat oder nach dem Run gesagt werden. Ein solches Decision-Log ist Teil der Idee, aber heute nicht im Output.

## Vorgehen

1. Struktur der Seite festlegen: welche Ansichten, welche Blöcke, was immer und was optional erscheint.
2. Layout und Styling festlegen.
3. Phase für Phase den Inhalt durchgehen und entscheiden, was dazukommt, was wegfällt, was verstärkt und was reduziert wird. Fragen sollen je nach Komplexität mehr Raum und Visualisierung bekommen, das Problem selbst soll abstrakt zusammengefasst und visualisiert werden.
4. Danach das Template in den loom-Ordner übernehmen. Weave erzeugt und pflegt dann den Inhalt für diese Struktur.

## Offene Fragen

- Bleiben die md-Dateien die Quelle und das HTML liest sie, wie im Mockup? Oder schreibt weave ein eigenes Datenformat für das Template?
- Wie kommen Bemerkungen ins Log: nur über weave (Gates und Chat), oder zusätzlich über einen Befehl wie `/weave note <text>`, auch nach dem Run?
- Diagramme: schreibt weave SVG selbst, oder reicht etwas wie Mermaid, das einfacher zu pflegen ist?

## Dateien

- `template.html`: das Mockup, also Layout, CSS und die Logik, die die md-Dateien einliest.
- `build.py`: bettet einen Workspace samt Screenshots ins Template ein und schreibt `loom-view.html`. Aufruf `python build.py` für `dashboard-refinement` oder `python build.py <workspace>` für einen anderen.
- `loom-view.html`: das Ergebnis, direkt im Browser öffnen. Braucht Internet für Schrift und Markdown-Parser.
