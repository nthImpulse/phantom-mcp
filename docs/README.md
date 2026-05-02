# phantom-mcp

Serveur MCP qui permet a Claude Code de voir et controler des simulateurs iOS, emulateurs Android, et vrais devices. 24 tools pour tester des apps mobiles sans quitter le terminal.

Claude peut prendre des screenshots, lire l'ecran, taper, scroller, remplir des champs, verifier des assertions, enregistrer des videos — automatiquement, sur iOS et Android.

Un rapport de test avec screenshots est genere **automatiquement** a chaque session de test.

---

## Architecture

```
Claude Code
    | MCP protocol (stdio)
    v
Phantom (Node.js TypeScript)
    |                       |
    v                       v
iOS                      Android
  xcrun simctl             ADB
  WebDriverAgent           UIAutomator
  (localhost:8100)         (adb shell)
    |                       |
    v                       v
Simulateur / iPhone    Emulateur / Device
```

---

## Prerequis

| Outil | Requis pour | Comment verifier |
|-------|------------|-----------------|
| macOS 13+ | tout | - |
| Xcode 15+ | iOS | `xcode-select -p` |
| Node.js 18+ | tout | `node --version` |
| Appium 3+ | iOS (WDA) | `appium --version` |
| xcuitest driver | iOS (WDA) | `appium driver list --installed` |
| Android SDK | Android | `adb version` |

---

## Installation

### Option A — npm (recommande)

```bash
# 1. Installer le package
npm install -g phantom-mcp

# 2. Installer Appium + driver iOS
npm install -g appium
appium driver install xcuitest

# 3. Enregistrer dans Claude Code
claude mcp add -s user phantom -- npx phantom-mcp
```

### Option B — depuis les sources

```bash
git clone https://github.com/nthimpulse/phantom-mcp.git
cd phantom-mcp
npm install
npm run build
claude mcp add -s user phantom -- node "$(pwd)/build/index.js"
```

---

## Les 24 tools

### Device management
| Tool | Description |
|------|-------------|
| `list_devices` | Liste tous les devices (iOS sims + Android emus + vrais devices) |
| `set_device` | Selectionne le device actif. Boot auto si eteint. Auto-prepare le device (opt-out via skip_setup) |
| `prepare_device` | Met le device dans un etat propre : clear clipboard / status bar overrides / dismiss keyboard / force QWERTY iOS |

### Observation
| Tool | Description |
|------|-------------|
| `screenshot` | Capture l'ecran du device actif |
| `get_ui_tree` | Arbre d'accessibilite avec index [N] pour chaque element |
| `wait_for_element` | Attend qu'un element apparaisse (avec timeout) |
| `scroll_until_visible` | Scroll jusqu'a trouver un element |

### Assertions
| Tool | Description |
|------|-------------|
| `assert_visible` | Verifie qu'un texte EST a l'ecran |
| `assert_not_visible` | Verifie qu'un texte N'EST PAS a l'ecran |

### Interaction
| Tool | Description |
|------|-------------|
| `tap` | Tape (par index, coordonnees, ou texte). Auto-dismiss du clavier si la cible est masquee |
| `long_press` | Appui long (menus contextuels) |
| `type_text` | Saisie de texte avec option clear, et option verify pour relire la valeur apres typing |
| `swipe` | Swipe (up/down/left/right) |
| `dismiss_keyboard` | Ferme le clavier soft (no-op si pas visible) |

### Navigation
| Tool | Description |
|------|-------------|
| `deep_link` | Ouvre une URL / deep link |

### Device actions
| Tool | Description |
|------|-------------|
| `shake` | Simule un shake |
| `rotate` | Change l'orientation (portrait/landscape) |
| `video_record` | Demarre/arrete l'enregistrement video |

### App lifecycle
| Tool | Description |
|------|-------------|
| `launch_app` | Lance une app par bundle ID / package name |
| `kill_app` | Ferme une app |

### Analyse & Automation (Tier 3)
| Tool | Description |
|------|-------------|
| `accessibility_audit` | Audit accessibilite : labels manquants, tap targets trop petits, images sans alt text |
| `test_report` | Rapport de test automatique : start pour commencer le suivi, end pour generer le markdown. Chaque action est tracee automatiquement. |
| `visual_diff` | Compare deux screenshots pixel par pixel pour detecter les regressions visuelles |
| `multi_device` | Execute la meme action sur plusieurs devices en une commande |

---

## Fonctionnement automatique

### Selection de device
Phantom ne boot jamais un device automatiquement. Il te demande de choisir :
1. Si 1 seul device est actif, il l'utilise automatiquement
2. Si plusieurs, il te demande de choisir avec `set_device`
3. Si aucun, il te montre la liste des devices disponibles

### Auto-launch WDA (iOS)
WebDriverAgent est lance automatiquement au premier tool iOS qui en a besoin. Premier lancement ~60-90s (build Xcode), ensuite instantane.

### ADB multi-device (Android)
Toutes les commandes ADB ciblent le device selectionne via `-s <serial>`. Pas de confusion multi-device.

### Saisie de texte (AZERTY compatible)
La saisie utilise pbcopy + Cmd+V (paste) au lieu du clavier virtuel. C'est instantane et fonctionne sur tous les layouts clavier (AZERTY, QWERTY, etc.).

### Rapport de test automatique
Chaque action (tap, type, swipe, assert...) est automatiquement enregistree avec un screenshot. A la fin du test, un rapport markdown est genere dans `/tmp/phantom-report-xxx/`.

---

## Securite

- Toutes les commandes systeme passent par `execFile` (pas de shell)
- Inputs valides par regex : bundle IDs, UDIDs, package names, AVD names, URLs
- Predicats iOS echappes (anti-injection)
- Texte Android echappe pour le shell device
- Zero `as any`, zero `exec()` shell

---

## Configuration

Variables d'environnement optionnelles :
- `PHANTOM_WDA_PATH` — chemin vers WebDriverAgent (defaut: ~/.appium/...)
- `PHANTOM_WDA_URL` — URL WDA (defaut: http://localhost:8100)

---

## Troubleshooting

### WDA crash en boucle
MobAI ou un autre outil utilise le port 8100.
```bash
lsof -i :8100
pkill -f "MobAI"
```

### "Aucun device disponible"
```bash
xcrun simctl list devices available   # iOS
adb devices -l                        # Android
```

### WDA ne demarre pas
```bash
cd ~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent
xcodebuild -project WebDriverAgent.xcodeproj \
  -scheme WebDriverAgentRunner \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
  test
```

### ADB non trouve
```bash
ls ~/Library/Android/sdk/platform-tools/adb
```

---

## Structure du projet

```
phantom/
  src/
    index.ts                Point d'entree MCP (24 tools)
    platforms/
      types.ts              Interfaces communes
      ios/
        simctl.ts            Wrapper xcrun simctl
        wda.ts               Client WDA + auto-launch
      android/
        adb.ts               Wrapper ADB complet
    tools/                   24 tools (21 fichiers)
    utils/
      device-manager.ts      Detection + routing multi-device
      xml.ts                 Parser XML partage
  docs/
    README.md               Ce fichier
    TUTORIAL.md             Tuto pas-a-pas
    FLOWS.md                Exemples de flows de test
```
