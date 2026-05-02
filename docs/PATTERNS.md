# Patterns pratiques

Recettes éprouvées pour des interactions courantes qui ne sont pas évidentes au premier abord. Tous les patterns ont été utilisés en pratique sur de vraies sessions de test.

---

## DatePicker iOS

### Workflow
```
1. tap(index=<DatePicker input>)         → ouvre le picker compact
2. tap(text="Date Picker")                → ouvre le calendar fullscreen
3. tap(text="Next Month") (× N)           → naviguer au bon mois
4. tap(text="Friday 8 May")               → sélectionner la date
5. tap(x=200, y=300)                      → tap dehors pour dismiss popup
6. tap(text="OK")                         → confirmer la sélection
```

### Notes
- `Previous Month` est `disabled` quand le mois affiché contient des dates passées only
- Les dates passées sont marquées `disabled` dans le tree — utiliser `enabled` filter
- Pour les date pickers avec `minDate` (ex: return date après departure), le picker peut afficher J-1 sélectionné par défaut alors que J-1 est `disabled` — bug app, pas phantom (voir [LIMITATIONS](LIMITATIONS.md))

---

## Bottom sheet sans UI tree (Modal RN)

### Workflow
Quand `get_ui_tree` retourne `"Aucun élément visible"` après ouverture d'une bottom sheet :

```
1. screenshot()                           → confirmer visuellement que le sheet est ouvert
2. Lire le code source du component       → connaître l'ordre exact des options
3. tap(x=<centre>, y=<offset calculé>)    → tap par coordonnées
4. get_ui_tree() après                    → vérifier que l'action a marché
```

### Calcul d'offset typique iPhone (height=874)
- Title de la sheet : y ≈ 540
- Option 1 : y ≈ 580
- Option 2 : y ≈ 635
- Option 3 : y ≈ 690
- Option 4 : y ≈ 745
- Option 5 : y ≈ 800

Ajuster si la sheet a moins/plus d'options.

---

## TextField avec autocomplete (sans confiance dans `type_text`)

### Workflow
```bash
echo -n "Paris" | xcrun simctl pbcopy <UDID>
```
```
1. tap(textfield)                         → focus
2. long_press(textfield, duration=1.5)    → menu contextuel iOS
3. tap(text="Paste")                      → coller
4. get_ui_tree() → vérifier value="Paris" → ne JAMAIS assumer
```

### Si "Paste" pas détecté Phantom
Tap par coordonnées sur le menu contextuel (typiquement y ≈ y_textfield - 50, x = même que le tap initial).

### Alternative : laisser l'autocomplete travailler
Si le textfield a un picker d'options en dropdown :
```
1. type_text("par", clear_first=true)     → écrire 2-3 lettres
2. get_ui_tree() → trouver l'option        → ex: "Paris, France"
3. tap(text="Paris, France")              → sélectionner via picker
```
Plus fiable que de taper le mot complet.

---

## Carousel horizontal de cartes (Dashboard trips)

### Pattern
Sur un Dashboard qui montre des cartes voyages côte à côte, `swipe(left)` peut **ouvrir** la carte voisine au lieu de juste scroller le carousel.

### Workflow
```
1. get_ui_tree()                          → voir quels trips sont visibles
2. tap(text="Tokyo")                      → ouvre directement Tokyo trip
   (au lieu de swipe pour faire défiler)
```

### Si vraiment besoin de scroll horizontal
- Swipe avec `distance=short` au lieu de `long` (moins de risque d'ouvrir)
- Tester d'abord sur 1 trip pour calibrer

---

## Sélectionner une alternative dans une suggestion sheet

### Pattern
Dans EditItinerary, le 1er tap sur une activité **sélectionne** la row, le 2ème tap **ouvre** le sheet "Replace with alternatives".

### Workflow
```
1. tap(text="Shinjuku Gyoen Park")         → 1er tap = select
2. tap(text="Shinjuku Gyoen Park")         → 2e tap = ouvre Replace sheet
3. <wait 3-5s>                              → fetch alternatives
4. tap(x=200, y=400)                       → tap sur 1ère alternative (sheet opaque)
5. get_ui_tree() → voir bouton "Replace with X" enabled
6. tap(index=<bouton Replace>)              → confirmer le swap
7. tap(text="Save Changes")                 → persister DB
```

---

## Long-press = 1.5s minimum

### Pattern
Pour les menus contextuels iOS (Copy/Paste, Replace, etc.), `duration=1` est **trop court** parfois et le long-press n'est pas détecté.

### Recommandation
Toujours utiliser `duration=1.5` minimum :
```
long_press(textfield, duration=1.5)
```

Pour les drag potentiel (long-press + move), `duration=0.5` peut suffire mais plus court rate la détection.

---

## Capture state transitions avec `get_ui_tree`

### Pattern
Après chaque action critique, **immédiatement** `get_ui_tree()` pour capturer le state. Ne jamais chaîner plusieurs actions sans vérification.

### Workflow recommandé
```
tap(...) → get_ui_tree() → vérifier state → next action
```

### Pourquoi
- Les indices changent après scroll/rerender
- Une action peut échouer silencieusement (target non trouvé, écran différent)
- Permet de débrancher tôt si quelque chose part en vrille

### Anti-pattern
```
tap(...) → tap(...) → tap(...) → get_ui_tree()
                                  ↑ ici tu sais juste que la dernière action a marché
```

---

## kill+relaunch pour resync un store local après mutation serveur

### Pattern
Quand une mutation côté serveur (RPC, edge function, webhook RevenueCat, etc.) doit refresh un store local (Zustand, Redux, MobX) mais que l'app affiche encore des données stale.

### Workflow
```
1. Action qui mute le serveur                (ex: Save sur un écran d'édition)
2. kill_app(bundle_id)                       → fermer l'app
3. launch_app(bundle_id)                     → la relancer
4. Naviguer vers l'écran à vérifier
5. get_ui_tree() → confirmer le state correct
```

### Quand l'utiliser
- Après un upgrade d'abonnement (event tiers comme RevenueCat / Stripe)
- Après un Save sur un formulaire d'édition (profil, paramètres, contenu)
- Après une mutation cross-screen (delete d'une ressource qui doit disparaître ailleurs)
- Après création d'une entité qui doit apparaître dans une autre vue

### Note
Au-delà du contournement d'un éventuel bug de sync de store, c'est aussi une **discipline de test** : ça force à valider la persistance réelle (DB → app froide), pas juste le state en mémoire après une mutation.

---

## Swipe direction conventions

### Confusion classique
- `swipe(up)` = geste de tirer le contenu vers le haut → **scroll DOWN dans la page**
- `swipe(down)` = geste de tirer vers le bas → **scroll UP dans la page**
- `swipe(left)` = geste de pousser vers la gauche → **next page / scroll RIGHT in carousel**
- `swipe(right)` = geste vers droite → **back / scroll LEFT in carousel**

### Recommandation
Documenter ça dans la docstring du tool `swipe` pour éviter les confusions répétées.

---

## DB query > UI scan pour audits massifs

### Pattern
Quand tu dois auditer 200+ items (ex: pet-friendly badges sur tous les trips), ne pas scroll l'UI pour chaque. Utiliser `mcp__supabase__execute_sql`.

### Exemple
```sql
SELECT trip_id, day_idx, activity_idx, title, is_pet_friendly
FROM jsonb_array_elements(daily_itinerary->'days') AS day,
     jsonb_array_elements(day->'activities') AS act
WHERE user_id = '...'
ORDER BY trip_id, day_idx;
```

### Quand l'utiliser
- Audit de cohérence sur N trips
- Vérifier la persistance après mutation UI
- Compter / statistiquer (% pet-friendly, nb trips avec X jours, etc.)

### Note
Ne dispense pas du test UI — un bug peut être visible uniquement dans l'UI (mauvais libellé, mauvais composant rendu) ou uniquement en DB (champ jamais persisté malgré ce que montre le formulaire).

---

## Re-tester après kill+relaunch (proxy persistence)

### Pattern
Après chaque mutation critique, valider à 4 niveaux :

1. **Action UI** via Phantom MCP
2. **Vérif UI immédiate** — `get_ui_tree` + `screenshot`
3. **Vérif DB** — `execute_sql` confirmer persistance backend
4. **Vérif persistance** — `kill_app` + `launch_app`, re-naviguer, confirmer cohérence UI+DB

### Si discrepancy entre UI et DB
Bug d'affichage à logger (catégorie store stale ou refresh manquant).

---

## Feedback bienvenu

Tu as un pattern pratique non documenté ici ? Ouvre une PR ou une issue.
