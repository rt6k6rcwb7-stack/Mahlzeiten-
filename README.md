# Mahlzeiten – einfacher Ernährungstracker

Kleine Web-App (PWA) zum Tracken von Mahlzeiten, Kalorien, Makros und Wasser.
Kein Server, kein Konto: alle Daten bleiben lokal im Browser (`localStorage`).

## Funktionen
- Tagesansicht mit Kalorienring, Eiweiß/Kohlenhydrate/Fett und Wasserzähler
- Mahlzeiten: Frühstück, Mittagessen, Abendessen, Snacks
- Lebensmittel aus mehreren Quellen: **Schweizer Nährwertdatenbank** (über 1.200 Lebensmittel, offline), **Richtwerte** für Fehlendes (z. B. Döner, Skyr), **Open Food Facts** (Online-Suche nach Namen und Barcode), **eigene** Lebensmittel und Gerichte – jeweils mit Quellen-Kennzeichnung
- **Korrigieren**: Einträge antippen, um Menge (Nährwerte werden mitgerechnet), Mahlzeit, Datum oder Nährwerte zu ändern; ebenso Aktivitäten und eigene Lebensmittel
- **Barcode-Scanner**: Produkt scannen → Nährwerte kommen aus [Open Food Facts](https://world.openfoodfacts.org); einmal gescannte Produkte werden lokal gespeichert und funktionieren danach auch offline. Unbekannte Produkte trägst du einmal von der Packung ein.
- **Gerichte**: Zutaten mit Mengen und Portionszahl speichern (z. B. Chili für 4 Portionen) oder eine eingetragene Mahlzeit per „Als Gericht speichern“ übernehmen; beim Eintragen nur noch die Portionen wählen
- **Gewicht**: manuell eintragen (optional mit Körperfett), Zielgewicht, Verlaufsdiagramm (30 Tage bis alles)
- **Withings-Import**: ZIP-Export („Meine Daten herunterladen“) oder `weight.csv` direkt einlesen; doppelte Messungen werden übersprungen
- **Zielrechner**: Kalorien- und Makroziele aus Alter, Größe, Gewicht, Aktivität und Ziel (Mifflin-St-Jeor), optional passend zu Zielgewicht und -datum
- **Weitere Nährstoffe**: Ballaststoffe (Mindestziel), Zucker und Salz (Maximum) – aus eingebauten Lebensmitteln, Open Food Facts und eigenen Lebensmitteln
- **Gewichtsziel mit Datum**: nötiges Tempo pro Woche, Trend der letzten 4 Wochen und Prognose, wann das Ziel erreicht wird
- **Ziele & Serien**: Wochenübersicht pro Ziel, aktuelle Serie und Rekord-Serie
- **Aktivitäten**: über 40 Sportarten/Tätigkeiten (MET-Werte, Verbrauch nach Körpergewicht) oder eigene kcal-Angabe; der Verbrauch erhöht das Tagesziel (100/75/50/0 % einstellbar)
- „Zuletzt“ verwendet und „Schnell“-Eintrag (nur kcal/Makros eingeben)
- Eigene Lebensmittel anlegen (Werte von der Verpackung)
- Verlauf: 7-Tage-Diagramm und 30-Tage-Liste
- Ziele anpassen, Export/Import als JSON-Backup
- **Darstellung**: 6 Akzentfarben, heller/dunkler Modus (oder automatisch nach System)
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

## Datenquellen
- **Schweizer Nährwertdatenbank**, Version 7.1 – Bundesamt für Lebensmittelsicherheit und Veterinärwesen BLV,
  [naehrwertdaten.ch](https://naehrwertdaten.ch). Nutzung mit Quellenvermerk erlaubt (auch für Ernährungstagebuch-Apps).
  `swissfoods.js` wird mit `tools/convert_swiss.py` aus der Excel-Datei erzeugt:
  `python3 tools/convert_swiss.py Schweizer_Nahrwertdatenbank.xlsx swissfoods.js` (benötigt `openpyxl`).
  Getränke werden über die Dichte auf 100 ml umgerechnet; Portionsgrößen und deutsche Suchbegriffe ergänzt die App.
- **Open Food Facts** – Open Database License (ODbL), [openfoodfacts.org](https://world.openfoodfacts.org).
- **Richtwerte** in `foods.js` – gerundete Durchschnittswerte für Lebensmittel, die in der Schweizer Datenbank fehlen.
