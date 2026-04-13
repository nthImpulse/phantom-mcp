# Tutoriel — phantom-mcp

Guide pas-a-pas pour installer et utiliser phantom-mcp avec Claude Code.

---

## Etape 1 — Prerequis

### iOS
```bash
xcode-select -p                    # Xcode installe ?
xcrun simctl list devices | grep iPhone   # Simulateurs dispo ?
appium --version                   # Appium installe ?
appium driver list --installed     # xcuitest driver ?
```

Si Appium manque :
```bash
npm install -g appium
appium driver install xcuitest
```

### Android
```bash
adb version                        # ADB installe ?
~/Library/Android/sdk/emulator/emulator -list-avds   # Emulateurs dispo ?
```

Si ADB manque : installe Android Studio ou le SDK command-line tools.

---

## Etape 2 — Installer phantom-mcp

### Option A — npm (recommande)
```bash
npm install -g phantom-mcp
```

### Option B — depuis les sources
```bash
git clone https://github.com/nthimpulse/phantom-mcp.git
cd phantom-mcp
npm install
npm run build
```

---

## Etape 3 — Enregistrer dans Claude Code

```bash
# Si installe via npm :
claude mcp add -s user phantom -- npx phantom-mcp

# Si installe depuis les sources :
claude mcp add -s user phantom -- node "$(pwd)/build/index.js"
```

Verifie :
```bash
claude mcp list
# → phantom: ... - Connected
```

Relance Claude Code pour charger les tools.

---

## Etape 4 — Premiers tests

### Test 1 — Lister les devices
```
Liste les devices disponibles
```
Claude appelle `list_devices`. Tu vois tes simulateurs iOS + emulateurs Android + vrais devices.

### Test 2 — Selectionner un device
```
Selectionne l'iPhone 17 Pro pour les tests
```
Claude appelle `set_device`. Si le sim est eteint, il le boot automatiquement.

### Test 3 — Screenshot
```
Prends un screenshot
```
Claude appelle `screenshot` et affiche l'image.

### Test 4 — UI Tree
```
Montre-moi les elements visibles
```
Claude appelle `get_ui_tree` :
```
[0] StaticText "Bienvenue" (20,100 350x35) enabled
[1] TextField "" placeholder="Email" (20,200 350x44) enabled
[2] Button "Se connecter" (20,300 350x52) enabled
```

### Test 5 — Tap + Saisie
```
Tape sur le champ Email et ecris "test@example.com"
```
Claude appelle `tap` puis `type_text`.

### Test 6 — Assertions
```
Verifie que "Bienvenue" est affiche a l'ecran
```
Claude appelle `assert_visible` → retourne PASS ou FAIL.

### Test 7 — Attendre un element
```
Attends que "Chargement termine" apparaisse (max 15s)
```
Claude appelle `wait_for_element` avec timeout.

### Test 8 — Deep link
```
Ouvre le deep link myapp://profile dans l'app
```
Claude appelle `deep_link`.

### Test 9 — Enregistrer une video
```
Demarre l'enregistrement video, fais quelques actions, puis arrete
```
Claude appelle `video_record(start)` → actions → `video_record(stop)`.

### Test 10 — Scroll
```
Scroll vers le bas jusqu'a trouver "Conditions generales"
```
Claude appelle `scroll_until_visible`.

### Test 11 — Audit accessibilite
```
Verifie l'accessibilite de l'ecran actuel
```
Claude appelle `accessibility_audit` → rapport avec violations (labels manquants, tap targets trop petits, images sans alt text).

### Test 12 — Rapport de test automatique
```
Demarre un rapport de test "Login Flow".
Teste le login avec test@example.com / Test1234!
Genere le rapport.
```
Claude appelle `test_report(start)` → puis chaque action (tap, type_text, swipe, assert...) est **automatiquement enregistree** avec un screenshot. A la fin, `test_report(end)` genere un markdown complet avec toutes les etapes, screenshots, et resultats PASS/FAIL.

Tu n'as PAS besoin d'appeler `step` — c'est automatique.

### Test 13 — Diff visuel
```
Prends un snapshot de l'ecran d'accueil.
Fais une modification, puis compare avec le snapshot.
```
Claude appelle `visual_diff(snapshot)` → modification → `visual_diff(compare)` → retourne le % de difference.

### Test 14 — Multi-device
```
Prends un screenshot sur l'iPhone et le Pixel en meme temps
```
Claude appelle `multi_device(device_ids: [...], action: "screenshot")` → retourne les 2 images.

---

## Multi-device

### Tester sur iOS et Android
```
1. Liste les devices
2. Selectionne l'iPhone 16e
3. Teste le login
4. Selectionne le Pixel 6
5. Teste le meme login
```

Claude switch automatiquement entre les plateformes.

### Ce qui se passe au switch
Quand tu changes de device avec `set_device` :
- Le cache UI tree est vide (les coordonnees changent)
- WDA est relance si tu passes d'un sim iOS a un autre
- ADB cible le bon serial pour Android

---

## Tips pour les prompts

### Sois specifique
```
# Vague
Teste mon app

# Precis
Lance com.monapp.ios, va sur l'ecran d'inscription,
remplis email avec test@example.com et mot de passe Test1234!,
tape sur "Creer mon compte", verifie que "Bienvenue" apparait
```

### Demande des verifications
```
Apres chaque action, verifie avec assert_visible que le bon ecran est affiche
```

### Enchaine les actions
```
Lance l'app, tape sur Rechercher, ecris "Paris",
scroll jusqu'a voir des resultats, tape sur le premier
```

---

## Bundle ID / Package Name

### iOS (Expo)
```json
{ "expo": { "ios": { "bundleIdentifier": "com.monapp.ios" } } }
```

### Android (Expo)
```json
{ "expo": { "android": { "package": "com.monapp.android" } } }
```

---

## Desinstaller

```bash
claude mcp remove -s user phantom
```
