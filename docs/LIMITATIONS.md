# Limitations connues

Ce que phantom-mcp **ne peut pas** faire (encore) ou fait mal en pratique. Documenter les limites permet à l'utilisateur (toi ou Claude) de choisir le bon fallback au lieu de boucler.

Toutes les limitations ci-dessous ont été observées en pratique sur de vraies sessions de test (iOS Simulator, app React Native / Expo SDK 55).

---

## 1. Modals React Native opaques pour `get_ui_tree`

### Symptôme
`mcp__phantom__get_ui_tree` retourne `"Aucun élément visible"` quand un `<Modal transparent>` est ouvert, alors que le modal est bien visible à l'écran (et un `screenshot` le prouve).

### Reproductible
- Pattern `Modal + Pressable overlay + Pressable sheet` (typique iOS bottom sheet)
- Exemples observés : menus actions (Export PDF / Share / Edit / Delete), bottom sheets de composition, picker d'activités

### Workarounds
1. **Tap par coordonnées approximatives** — calculer la position de la sheet (~70% écran depuis le bas) puis tap au centre des options
2. **Lire le code source** pour connaître l'ordre des options dans le modal, puis tap par y-offset (option 1 ≈ y=580, option 2 ≈ y=635, etc.)
3. **Ajouter `testID` partout** dans l'app — Phantom peut alors cibler par texte/testID même si le tree reste opaque
4. **Screenshot + verification manuelle** — fallback ultime quand la repro est critique

### Note
Ce n'est probablement pas un bug de phantom-mcp lui-même mais une limitation du XCUITest / accessibility tree iOS pour les modals avec `transparent={true}`. À investiguer côté WDA.

---

## 2. `type_text` peut taper le mauvais texte

### Symptôme
Demander `type_text("Paris")` peut produire `"av"` ou un texte tronqué dans le textfield. L'autocomplete d'un picker ouvert peut intercepter les keystrokes.

### Reproductible
- TextField avec autocomplete actif (départ/destination de voyage)
- Champs adjacents (le focus peut sauter)

### Workarounds
1. **Pattern pbcopy + long_press + Paste**
   ```bash
   echo -n "Paris" | xcrun simctl pbcopy <UDID>
   ```
   ```
   tap(textfield)
   long_press(textfield, duration=1.5)
   tap("Paste")
   ```
2. **Tap par option d'autocomplete** — laisser le picker faire le travail (taper 2-3 lettres puis tap sur la suggestion)
3. **Vérifier après chaque `type_text`** — `get_ui_tree` doit confirmer la `value=` du textfield, ne jamais assumer que le texte est correct

### Note
Voir aussi [Feature Request #2 — `clear_field` atomique](FEATURE_REQUESTS.md) — le paramètre `clear_first` du `type_text` est fragile.

---

## 3. `scroll_until_visible` faux positifs

### Symptôme
`scroll_until_visible(text="Day 7")` peut s'arrêter dès qu'il trouve un match partiel — par exemple le label de stat `"days"` ou `"flights"` au début de l'écran, au lieu du vrai "Day 7" plus bas.

### Reproductible
- Texte cherché contenu dans un autre élément à l'écran (sub-string match)
- Stat counters / pluriels qui contiennent le mot

### Workarounds
1. **Texte plus discriminant** — chercher `"Day 7 "` (avec espace ou ponctuation finale) au lieu de `"Day 7"`
2. **Chercher la date complète** — `"06/07/2026"` est plus unique que `"Day 7"`
3. **Manuel** : `swipe(up)` boucle + `get_ui_tree` après chaque, vérifier le terme en regex

### Note
Le tool fait un `includes()` substring check, pas un word-boundary match. Documenter ça en docstring du tool aiderait.

---

## 4. Drag-and-drop pas supporté

### Symptôme
Aucun tool pour réordonner par drag (typique d'un EditItinerary qui a des `<DraggableItemList>`).

### Workarounds
1. **Tap deux fois sur l'item** — ouvre le menu Replace alternatif (si l'app le supporte)
2. **Long-press + déplacement manuel** — non supporté actuellement
3. **Test manuel** — le drag-drop doit être validé à la main, ou attendre une feature `drag_and_drop`

### Note
Voir [Feature Request #5 — `drag_and_drop`](FEATURE_REQUESTS.md). XCUITest a `pressForDuration:thenDragToCoordinate:` qui pourrait être exposé.

---

## 5. Apple Passwords modal bloque

### Symptôme
Pendant un signup réel, iOS suggère un mot de passe via Apple Passwords. Le modal natif ne se dismiss pas via `tap("Choose my own password")` (le bouton n'apparaît pas dans `get_ui_tree`).

### Workarounds
1. **Test sur device réel** — où l'utilisateur peut dismiss manuellement
2. **Pre-fill via `type_text` rapide** avant que le modal s'affiche (race condition, fragile)
3. **Désactiver iCloud Keychain** dans les settings du simulateur avant la session de test

### Note
Limitation iOS, pas phantom-mcp. Mais à documenter pour que les utilisateurs ne perdent pas du temps dessus.

---

## 6. `simctl status_bar override` ne désactive pas vraiment le réseau

### Symptôme
Pour tester le mode offline, `xcrun simctl status_bar override --wifiMode failed` change uniquement l'icône de status bar, pas le vrai networking. L'app continue à faire des requêtes HTTP avec succès.

### Workarounds
1. **Network Link Conditioner** (utilitaire macOS séparé) — profil "100% Loss"
2. **`pfctl`** — règles firewall macOS pour bloquer le traffic outbound du simulateur
3. **Test manuel** — désactiver le wifi du Mac entier (mais ça déconnecte aussi les outils MCP)

### Note
Pas un bug phantom-mcp. À documenter quand même car c'est une attente fréquente.

---

## 7. Index `tap(index=N)` instable après scroll/state change

### Symptôme
Faire `tap(index=17)` sur un élément vu dans `get_ui_tree`, puis re-tap après un scroll/changement d'état — les index sont décalés. Le tap atterrit sur un élément différent (souvent un tab adjacent).

### Reproductible
- Liste qui se rerend après scroll
- Tab bar / segmented control qui change le contenu en dessous

### Workarounds
1. **Re-call `get_ui_tree` avant chaque tap** — ne jamais réutiliser un index entre actions
2. **Tap par texte/testID** — plus stable que par index
3. **Tap par coordonnées** quand l'élément a une position fixe (header, FAB, etc.)

### Note
Pas un bug — c'est le bon comportement (l'arbre change). Mais c'est un piège facile à tomber dedans.

---

## 8. Carousel horizontal Dashboard ≠ scroll vertical timeline

### Symptôme
Sur un Dashboard avec carousel de cartes voyages, `swipe(left, distance=long)` peut soit naviguer entre voyages, soit ouvrir directement le voyage suivant — selon la zone exacte du swipe.

### Workarounds
1. **Tap directement sur le voyage cible** par texte ("Tokyo", "Tunis", etc.) si visible
2. **Spécifier coordonnées de swipe** (pas supporté actuellement, voir [Feature Request #4](FEATURE_REQUESTS.md))
3. **Tester plusieurs fois** — comportement parfois variable selon distance

### Note
À investiguer : ajouter un paramètre `from_x, from_y, to_x, to_y` au tool `swipe` pour contrôler la zone exacte.

---

## 9. `dismiss popup` invisible / non documenté

### Symptôme
Quand un DatePicker iOS est ouvert, il faut souvent tap "à l'extérieur" pour le fermer. `get_ui_tree` montre un élément `Button "dismiss popup" (0,0 402x874)` qui couvre tout l'écran — pas évident que c'est le mécanisme.

### Workarounds
1. **Tap sur une coordonnée qui n'est pas dans le DatePicker** — typiquement le haut de l'écran (y=200-300)
2. **Tap explicit "dismiss popup" par texte** — fonctionne mais peu intuitif

### Note
Documenter ce pattern dans un guide DatePicker dédié — voir [PATTERNS.md](PATTERNS.md).

---

## Feedback bienvenu

Si tu rencontres une limitation non listée ici, ouvre une issue avec :
- Le tool concerné
- L'app / écran sur lequel ça arrive
- Le `get_ui_tree` partiel + `screenshot` si possible
- Le workaround que tu as utilisé

Plus on documente les limitations, plus phantom-mcp devient utile en pratique.
