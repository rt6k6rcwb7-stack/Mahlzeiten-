# Mahlzeiten – einfacher Ernährungstracker

Kleine Web-App (PWA) zum Tracken von Mahlzeiten, Kalorien, Makros und Wasser.
Kein Server, kein Konto: alle Daten bleiben lokal im Browser (`localStorage`).

## Funktionen
- Tagesansicht mit Kalorienring, Eiweiß/Kohlenhydrate/Fett und Wasserzähler
- Mahlzeiten: Frühstück, Mittagessen, Abendessen, Snacks
- Lebensmittel-Suche (~65 gängige Lebensmittel, Werte pro 100 g/ml) mit Mengen- und Portionsauswahl
- **Barcode-Scanner**: Produkt scannen → Nährwerte kommen aus [Open Food Facts](https://world.openfoodfacts.org); einmal gescannte Produkte werden lokal gespeichert und funktionieren danach auch offline. Unbekannte Produkte trägst du einmal von der Packung ein.
- **Gerichte**: Zutaten mit Mengen und Portionszahl speichern (z. B. Chili für 4 Portionen) oder eine eingetragene Mahlzeit per „Als Gericht speichern“ übernehmen; beim Eintragen nur noch die Portionen wählen
- **Gewicht**: manuell eintragen (optional mit Körperfett), Zielgewicht, Verlaufsdiagramm (30 Tage bis alles)
- **Withings-Import**: ZIP-Export („Meine Daten herunterladen“) oder `weight.csv` direkt einlesen; doppelte Messungen werden übersprungen
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

## Hinweise zum Scanner
- Die Kamera funktioniert nur über HTTPS (z. B. GitHub Pages) oder `localhost`.
- Android/Chrome nutzt den eingebauten `BarcodeDetector`; andere Browser (z. B. Safari auf dem iPhone)
  nutzen die mitgelieferte WebAssembly-Variante in `vendor/` ([barcode-detector](https://github.com/Sec-ant/barcode-detector) / [zxing-wasm](https://github.com/Sec-ant/zxing-wasm), MIT-Lizenz).
