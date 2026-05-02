# Feature requests

Tools / améliorations proposées par usage en production. Classées par priorité (impact × fréquence du problème).

---

## #1 — `setup_device` tool (priorité haute)

### Problème
Au début de chaque session de test, plusieurs setups récurrents posent problème :
- Le clavier iOS peut être en **AZERTY** (locale FR) → `type_text("Paris")` peut produire des caractères incorrects
- Le clavier peut être **affiché à l'écran** d'une session précédente → bloque les premiers tap sur des éléments cachés
- Le clipboard contient peut-être des restes de session précédente
- Status bar override peut traîner depuis un test précédent

### Proposition
Nouveau tool `setup_device` qui se lance **automatiquement** quand `set_device` ou `launch_app` est appelé pour la première fois (ou explicitement par l'utilisateur).

### Comportement
```typescript
setup_device({
  keyboard_layout?: 'qwerty' | 'azerty' | 'auto',  // default: 'qwerty'
  dismiss_keyboard?: boolean,                       // default: true
  reset_clipboard?: boolean,                        // default: true
  reset_status_bar?: boolean,                       // default: true
  language?: 'en' | 'fr' | string,                  // default: 'en'
})
```

### Implémentation iOS (proposée)
```bash
# Force keyboard QWERTY (en_US hw=US;sw=QWERTY)
xcrun simctl spawn <UDID> defaults write -g AppleKeyboards -array "en_US@hw=US;sw=QWERTY"

# Set system language to en (force qwerty as default)
xcrun simctl spawn <UDID> defaults write NSGlobalDomain AppleLanguages -array '("en")'

# Dismiss keyboard if visible (XCUITest)
# (via WebDriverAgent: tap on coordinate outside keyboard, or send Esc key)

# Clear clipboard
echo -n "" | xcrun simctl pbcopy <UDID>

# Reset status bar
xcrun simctl status_bar <UDID> clear
```

### Auto-trigger
- Appeler `setup_device` automatiquement la première fois que `set_device` est appelé dans une session
- Ne pas re-lancer à chaque tool call (ce serait overhead)
- Permettre opt-out avec `setup_device({ skip: true })` si besoin

### Pourquoi
Évite des heures de debug confus quand `type_text("Paris")` produit `"av"` ou des caractères bizarres juste à cause de la locale AZERTY active.

---

## #2 — `clear_field` atomique

### Problème
Le paramètre `clear_first` du tool `type_text` n'efface pas toujours le champ proprement. Symptôme : on demande `clear_first=true, text="Paris"` et on obtient `"av"` ou des résidus.

### Proposition
Nouveau tool `clear_field` dédié, atomique :
```typescript
clear_field({
  index?: number,
  text?: string,
  testID?: string,
  // Méthode interne: select all + delete (cmd+A + delete)
})
```

### Pourquoi
Sépare les responsabilités. `type_text` ne devrait pas avoir à gérer le clear, et `clear_field` peut utiliser un mécanisme différent (select all + delete vs delete-key spam).

---

## #3 — `dismiss_keyboard` tool

### Problème
Quand le clavier est ouvert (après un type_text), il bloque la moitié de l'écran. On ne peut pas tap sur certains boutons en bas. Workaround : tap quelque part en dehors, mais ça peut tap sur autre chose.

### Proposition
```typescript
dismiss_keyboard()
```

### Implémentation
- iOS : envoyer `XCUIKeyboardKey.escape` via WDA, OU tap le bouton "return" du clavier, OU tap en dehors
- Android : `adb shell input keyevent KEYCODE_BACK` (ferme le keyboard sans back navigation si possible)

### Pourquoi
Très fréquent dans les workflows (form filling). Avoir un tool dédié évite les workarounds approximatifs.

---

## #4 — `swipe` avec coordonnées explicites

### Problème
Le tool `swipe(direction, distance)` actuel choisit la zone de swipe automatiquement (souvent le centre de l'écran y=437). Mais parfois on veut swipe uniquement dans une zone spécifique (ex: carousel horizontal en haut, sans toucher le carousel en bas).

### Proposition
Ajouter des paramètres optionnels :
```typescript
swipe({
  direction: 'up' | 'down' | 'left' | 'right',
  distance?: 'short' | 'medium' | 'long',
  from_x?: number,
  from_y?: number,
  to_x?: number,
  to_y?: number,
})
```

Si `from_*` / `to_*` sont fournis, ils overrident le calcul automatique.

### Pourquoi
Permet de scroll précisément dans un sub-container sans affecter le parent scrollview.

---

## #5 — `drag_and_drop` tool

### Problème
Aucun support pour drag-and-drop. Apps avec listes réordonnables (`<DraggableItemList>`) ne peuvent pas être testées de bout en bout.

### Proposition
```typescript
drag_and_drop({
  from_index?: number,
  from_x?: number,
  from_y?: number,
  to_index?: number,
  to_x?: number,
  to_y?: number,
  duration?: number,  // default 0.5s pour le press initial
})
```

### Implémentation
- iOS : XCUITest `pressForDuration:thenDragToCoordinate:`
- Android : `adb shell input swipe` avec long press (durée > 500ms)

### Pourquoi
Feature critique manquante pour tester n'importe quelle UI avec reorder.

---

## #6 — `set_clipboard` tool natif

### Problème
Le pattern `pbcopy + long_press + Paste` est fréquent mais nécessite shell out. Avoir un tool natif simplifierait.

### Proposition
```typescript
set_clipboard({
  text: string,
})
```

### Implémentation
- iOS : `xcrun simctl pbcopy <UDID>` (déjà ce qu'on fait)
- Android : `adb shell am broadcast -a clipper.set -e text "..."` ou pareil

### Pourquoi
Cohérence d'API + évite à l'utilisateur de connaître les détails simctl.

---

## #7 — `verify_field_value` tool

### Problème
Après `type_text`, on doit `get_ui_tree` puis chercher manuellement le textfield et vérifier sa `value=`. Verbose.

### Proposition
```typescript
verify_field_value({
  testID?: string,
  index?: number,
  expected: string,
})
```

Retourne `{ matches: boolean, actual_value: string }`.

### Pourquoi
Pattern fréquent. Avoir une assertion dédiée évite la boilerplate `get_ui_tree → find → check value`.

---

## #8 — `wait_for_modal` ou meilleur support modals RN

### Problème
Documenté en [LIMITATIONS #1](LIMITATIONS.md). Les modals React Native avec `<Modal transparent>` ne sont pas dans le tree.

### Proposition
Investiguer côté WebDriverAgent : est-ce qu'on peut récupérer le contenu d'un modal via une autre query (ex: `XCUIElementTypeOther` en root level avec différents predicates) ?

### Si pas possible
Au minimum, un tool `wait_for_modal` qui attend qu'un modal soit visible (via screenshot diff ou autre proxy) plutôt que de polling `get_ui_tree`.

### Pourquoi
Bloquant pour tester les bottom sheets, action menus, suggestion pickers. Fréquent dans les apps RN modernes.

---

## #9 — Auto-screenshot après chaque action (opt-in)

### Problème
Quand un test échoue ou produit un comportement inattendu, on n'a pas l'historique visuel sans avoir prévu les screenshots.

### Proposition
Config opt-in :
```typescript
set_device({
  device_id: '...',
  auto_screenshot: true,  // default: false
})
```

Si `auto_screenshot=true`, prendre un screenshot après chaque tap/swipe/long_press et l'inclure dans le rapport `test_report`.

### Pourquoi
Debug post-mortem facilité, surtout pour les comportements non reproductibles.

---

## #10 — `query_text` filtré par regex

### Problème
`get_ui_tree` retourne tout le tree, parfois 50+ éléments. Filtrer manuellement est verbose.

### Proposition
```typescript
query_text({
  pattern: string,         // regex
  type?: 'text' | 'button' | 'any',
})
```

Retourne `{ matches: Array<{ index, text, position }> }`.

### Pourquoi
Plus efficient que parser tout le tree pour chercher un terme. Aussi, permet des assertions style `expect`.

---

## Priorisation suggérée

| Priorité | Feature | Raison |
|----------|---------|--------|
| 🔴 P0 | #1 `setup_device` (qwerty + dismiss keyboard) | Bloque la productivité dès le 1er test FR locale |
| 🔴 P0 | #3 `dismiss_keyboard` | Très fréquent en form filling |
| 🟠 P1 | #5 `drag_and_drop` | Bloque test E2E pour beaucoup d'apps |
| 🟠 P1 | #2 `clear_field` atomique | Améliore robustesse type_text |
| 🟡 P2 | #4 `swipe` coords explicites | Quality-of-life |
| 🟡 P2 | #7 `verify_field_value` | Quality-of-life |
| 🟢 P3 | #6 `set_clipboard` | Sucre syntaxique |
| 🟢 P3 | #8 modals RN better support | Investigation WDA d'abord |
| 🟢 P3 | #9 auto-screenshot | Opt-in, low risk |
| 🟢 P3 | #10 `query_text` regex | Sucre syntaxique |

---

## Feedback bienvenu

Si tu as une feature en tête qui n'est pas listée ici, ouvre une issue avec le use case réel rencontré.
