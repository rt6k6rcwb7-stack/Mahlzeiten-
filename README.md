# Mahlzeiten – einfacher Ernährungstracker

Kleine Web-App (PWA) zum Tracken von Mahlzeiten, Kalorien, Makros und Wasser.
Kein Server, kein Konto: alle Daten bleiben lokal im Browser (`localStorage`).

## Funktionen
- Tagesansicht mit Kalorienring, Eiweiß/Kohlenhydrate/Fett und Wasserzähler
- Mahlzeiten: Frühstück, Mittagessen, Abendessen, Snacks
- Lebensmittel-Suche (~65 gängige Lebensmittel, Werte pro 100 g/ml) mit Mengen- und Portionsauswahl
- „Zuletzt“ verwendet und „Schnell“-Eintrag (nur kcal/Makros eingeben)
- Eigene Lebensmittel anlegen (Werte von der Verpackung)
- Verlauf: 7-Tage-Diagramm und 30-Tage-Liste
- Ziele anpassen, Export/Import als JSON-Backup
- Offline-fähig, auf dem Handy zum Homescreen hinzufügbar

## Starten
```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```
Für die Nutzung auf dem Handy z. B. über GitHub Pages veröffentlichen
(Settings → Pages → Branch wählen) und im Browser „Zum Startbildschirm hinzufügen“.
