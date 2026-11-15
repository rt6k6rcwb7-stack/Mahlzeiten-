"""Wandelt die Schweizer Nährwertdatenbank (Excel, BLV) in swissfoods.js für die App um."""
import sys, json, re, openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
ws = wb['Generische Lebensmittel']
rows = list(ws.iter_rows(values_only=True))
head = rows[2]
H = {}
for i, h in enumerate(head):
    if h and h not in ('Herleitung des Wertes', 'Quelle') and h not in H:
        H[h] = i

COL = {
    'kcal': 'Energie, Kilokalorien (kcal)', 'p': 'Protein (g)', 'c': 'Kohlenhydrate, verfügbar (g)',
    'f': 'Fett, total (g)', 'fib': 'Nahrungsfasern (g)', 'sug': 'Zucker (g)', 'salt': 'Salz (NaCl) (g)',
}

def num(v):
    """'Sp.' (Spuren), '<0.5' und 'k.A.' werden als 0 behandelt."""
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().replace(',', '.')
    if s in ('k.A.', '', '-'): return None
    if s.startswith('Sp') or s.startswith('<'): return 0.0
    try: return float(s)
    except ValueError: return None

def portion_for(cat, name, unit):
    c, n = cat.lower(), name.lower()
    if unit == 'ml':
        if 'bier' in n: return 330
        if 'wein' in c or 'wein' in n or 'sekt' in n or 'champagner' in n: return 150
        if 'spirituosen' in c or 'likör' in n or 'schnaps' in n: return 20
        if 'öle' in c or 'öl' in n.split(',')[0]: return 10
        if 'rahm' in c or 'sauce' in n or 'sirup' in n or 'essig' in n: return 20
        return 200
    if 'gerichte' in c: return 300
    if 'brote' in c and 'cerealien' not in c: return 50
    if 'cerealien' in c or 'flocken' in c: return 50
    if 'käse' in c: return 30
    if 'joghurt' in c or 'quark' in c or 'dessert' in c: return 150
    if 'butter' in n or 'fette' in c: return 10
    if 'wurst' in c: return 50
    if 'fleisch' in c or 'fisch' in c: return 150
    if 'eier' in c: return 60
    if 'trocken' in c or 'getrocknet' in n: return 30
    if 'früchte' in c or 'gemüse' in c: return 150
    if 'nüsse' in c or 'süssigkeiten' in c or 'snacks' in c: return 30
    if 'getreide' in c:
        if ', roh' in n or 'mehl' in n or 'griess' in n: return 70
        if 'kartoffel' in n: return 200
        return 180
    if 'pflanzliche protein' in c: return 100
    if 'verschiedenes' in c: return 15
    return 100

ALIASES = [
    (r'poulet', 'Hähnchen Hühnchen Huhn'), (r'^(voll|halb|doppel|kaffee|schlag)?rahm\b', 'Sahne'),
    (r'saurer halbrahm', 'saure Sahne Schmand'), (r'weggli|bürli|semmel', 'Brötchen'), (r'gipfeli', 'Croissant Hörnchen'),
    (r'teigwaren', 'Nudeln Pasta Spaghetti'), (r'glace', 'Eis Eiscreme Speiseeis'), (r'konfitüre', 'Marmelade'),
    (r'kartoffelstock', 'Kartoffelpüree Kartoffelbrei'), (r'baumnuss', 'Walnuss'), (r'zucchetti', 'Zucchini'),
    (r'nüsslisalat', 'Feldsalat'), (r'peperoni', 'Paprika'), (r'gehacktes', 'Hackfleisch Hack'),
    (r'frites', 'Pommes Pommes frites'), (r'cervelat', 'Wurst Fleischwurst'), (r'karotte', 'Möhre Mohrrübe Rüebli'),
    (r'federkohl', 'Grünkohl'), (r'^rande', 'Rote Bete Rote Beete'), (r'kefen', 'Zuckerschoten'), (r'zwetschge', 'Pflaume'),
    (r'hühnerei', 'Ei Eier'), (r'schweins', 'Schwein'), (r'^milch \(durchschnitt\)', 'Kuhmilch Vollmilch'),
    (r'bolognaise', 'Bolognese'), (r'wähe', 'Kuchen Blechkuchen'), (r'^brot \(durchschnitt\)', 'Brot Mischbrot'),
    (r'cornet', 'Eis Eistüte'), (r'pommes chips', 'Kartoffelchips Chips'), (r'paniermehl', 'Semmelbrösel'),
    (r'eierschwämm', 'Pfifferlinge'), (r'trute|truthahn', 'Pute Putenbrust Truthahn'), (r'broccoli', 'Brokkoli'),
    (r'müesli', 'Müsli'), (r'ruchbrot', 'Mischbrot Graubrot'), (r'hafergetränk', 'Hafermilch Haferdrink'),
    (r'sojagetränk', 'Sojamilch Sojadrink'), (r'mandelgetränk', 'Mandelmilch Mandeldrink'), (r'wienerli', 'Wiener Würstchen'),
    (r'plätzli', 'Schnitzel'), (r'dorsch', 'Kabeljau'), (r'pariserbrot', 'Baguette'), (r'colagetränk', 'Cola'),
    (r'schaumwein', 'Sekt'), (r'^traube', 'Weintrauben'), (r'laugenbrötli', 'Laugenbrötchen'),
    (r'laugengebäck', 'Brezel Laugenbrezel'), (r'schokolade, dunkel', 'Zartbitterschokolade Bitterschokolade'),
    (r'spätzli', 'Spätzle'), (r'^wein rot', 'Rotwein'), (r'^wein weiss', 'Weißwein'), (r'entrecôte', 'Steak Rindersteak'),
    (r'rohschinken', 'Schinken roh'), (r'pouletbrust|poulet, brust', 'Hähnchenbrust Hühnerbrust'),
    (r'quark, nature, mager', 'Magerquark'), (r'rind, gehacktes', 'Rinderhack Rinderhackfleisch'),
    (r'knuspermüesli', 'Knuspermüsli Granola Crunchy'), (r'pudding, vanille', 'Vanillepudding'),
    (r'pudding, schokolade', 'Schokopudding Schokoladenpudding'), (r'poulet, schenkel', 'Hähnchenschenkel Hähnchenkeule'),
    (r'lachs, geräuchert', 'Räucherlachs'), (r'köhler', 'Seelachs'), (r'^mandarine', 'Clementine'),
    (r'sauce', 'Soße'), (r'sojasauce', 'Sojasoße'), (r'^berliner', 'Krapfen Pfannkuchen'),
    (r'bier, alkoholfrei', 'Alkoholfreies Bier'), (r'schwein.*plätzli', 'Schweineschnitzel'),
    (r'colagetränk, mit süssstoff', 'Cola Zero Cola Light'),
    (r'pommes chips', 'Chips'), (r'erdnuss', 'Erdnüsse'), (r'gummibonbon', 'Gummibärchen Fruchtgummi'), (r'aprikose', 'Marille'), (r'lauch', 'Porree'), (r'rosenkohl', 'Kohlsprossen'),
]

foods, skipped = [], 0
for r in rows[3:]:
    name = r[H['Name']]
    if not name: continue
    name = re.sub(r'\s+', ' ', str(name)).strip()
    vals = {k: num(r[H[col]]) for k, col in COL.items()}
    if vals['kcal'] is None:
        skipped += 1; continue
    cat = str(r[H['Kategorie']] or '')
    dens = num(r[H['Dichte']])
    unit = 'g'
    if dens and dens > 0 and ('getränke' in cat.lower() or 'säfte' in cat.lower() or 'milch' in name.lower().split(',')[0] or 'öle' in cat.lower() or 'rahm' in cat.lower() or 'sauce' in name.lower() or 'sirup' in name.lower() or 'essig' in name.lower()):
        unit = 'ml'
        vals = {k: (v * dens if v is not None else None) for k, v in vals.items()}
    def rd(k, v):
        if v is None: return 0
        return round(v, 2) if k == 'salt' else round(v, 1)
    item = {'name': name}
    item.update({k: rd(k, v) for k, v in vals.items()})
    item['unit'] = unit
    item['portion'] = portion_for(cat, name, unit)
    syn = r[H['Synonyme']]
    syns = [re.sub(r'\s+', ' ', str(syn)).strip()] if syn else []
    # Deutsche Begriffe für Schweizer Bezeichnungen ergänzen (nur für die Suche)
    low = name.lower()
    for pat, alias in ALIASES:
        if re.search(pat, low): syns.append(alias)
    if syns: item['syn'] = ' '.join(dict.fromkeys(syns))
    item['cat'] = cat.split(';')[0].split('/')[0]
    foods.append(item)

with open(out, 'w', encoding='utf-8') as f:
    f.write('// Schweizer Nährwertdatenbank, Version 7.1 – Bundesamt für Lebensmittelsicherheit und\n')
    f.write('// Veterinärwesen BLV, naehrwertdaten.ch. Generische Lebensmittel, Werte pro 100 g\n')
    f.write('// (Getränke über die Dichte auf 100 ml umgerechnet). Portionsgrößen aus der Kategorie abgeleitet.\n')
    f.write('// Automatisch erzeugt – nicht von Hand bearbeiten.\n')
    f.write('window.SWISS_FOODS = [\n')
    for it in foods:
        f.write('  ' + json.dumps(it, ensure_ascii=False, separators=(', ', ': ')) + ',\n')
    f.write('];\n')
print(len(foods), 'Lebensmittel,', skipped, 'ohne kcal übersprungen,', sum(1 for x in foods if x['unit'] == 'ml'), 'in ml')
