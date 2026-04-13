# Exemples de flows de test

Chaque section = le prompt a donner a Claude + ce qu'il fait.

---

## Flow 1 — Verification ecran d'accueil

### Prompt
```
Lance l'app (bundle: com.monapp.ios) et prends un screenshot.
Dis-moi quels elements sont visibles.
```

### Ce que Claude fait
1. `launch_app` → lance l'app
2. `screenshot` → capture l'ecran
3. `get_ui_tree` → liste les elements

---

## Flow 2 — Inscription

### Prompt
```
Lance l'app, trouve le bouton d'inscription, tape dessus.
Remplis : Email=test@example.com, Mot de passe=Test1234!
Tape sur le bouton de validation.
Verifie que "Bienvenue" apparait.
```

### Ce que Claude fait
1. `launch_app` + `get_ui_tree` → trouve le bouton
2. `tap` → tape dessus
3. `type_text` → remplit les champs
4. `tap` → valide
5. `assert_visible("Bienvenue")` → PASS ou FAIL

---

## Flow 3 — Login

### Prompt
```
Connecte-toi avec user@test.com / password123.
Verifie que l'ecran change apres le login.
```

### Ce que Claude fait
1. `get_ui_tree` → trouve les champs
2. `type_text` → email + password
3. `tap` → bouton connexion
4. `wait_for_element("Accueil")` → attend la transition
5. `assert_visible("Accueil")` → confirme

---

## Flow 4 — Navigation + Scroll

### Prompt
```
Scroll vers le bas pour voir tout le contenu.
A chaque scroll, dis-moi les nouveaux elements.
```

### Ce que Claude fait
1. `screenshot` → capture le haut
2. `swipe(down)` → scroll
3. `get_ui_tree` → nouveaux elements
4. Repete jusqu'en bas

### Variante
```
Scroll jusqu'a trouver "Conditions generales"
```
→ `scroll_until_visible("Conditions generales")`

---

## Flow 5 — Recherche

### Prompt
```
Tape sur la barre de recherche, ecris "Paris",
verifie que des resultats s'affichent.
```

### Ce que Claude fait
1. `tap(text: "Rechercher")` → focus
2. `type_text("Paris")` → saisie
3. `wait_for_element("resultats")` → attend
4. `assert_visible("Paris")` → verifie

---

## Flow 6 — Validation de formulaire

### Prompt
```
Soumets le formulaire sans remplir les champs.
Verifie que des erreurs s'affichent.
Puis remplis et re-soumets.
```

### Ce que Claude fait
1. `tap` → bouton soumettre (champs vides)
2. `assert_visible("requis")` → erreur affichee
3. `type_text` → remplit les champs
4. `tap` → re-soumettre
5. `assert_not_visible("requis")` → erreurs disparues

---

## Flow 7 — Navigation multi-ecrans

### Prompt
```
Parcours l'app ecran par ecran. A chaque ecran,
prends un screenshot et liste les elements.
Essaie de revenir en arriere.
```

### Ce que Claude fait
1. `screenshot` + `get_ui_tree` par ecran
2. `tap` → navigation
3. `swipe(right)` → back (iOS)

---

## Flow 8 — Assertions de regression

### Prompt
```
Lance l'app et verifie que :
1. Le logo est visible
2. Le bouton "Commencer" est present
3. Aucun message d'erreur n'est affiche
```

### Ce que Claude fait
1. `launch_app` + `get_ui_tree`
2. `assert_visible("Logo")` → PASS
3. `assert_visible("Commencer")` → PASS
4. `assert_not_visible("Erreur")` → PASS

---

## Flow 9 — Enregistrement video

### Prompt
```
Enregistre une video pendant que tu testes le flow d'inscription.
```

### Ce que Claude fait
1. `video_record(start)` → demarre
2. Flow inscription complet
3. `video_record(stop)` → arrete + chemin du fichier

---

## Flow 10 — Deep link

### Prompt
```
Ouvre le deep link myapp://product/123 et verifie
que la page produit s'affiche.
```

### Ce que Claude fait
1. `deep_link("myapp://product/123")`
2. `wait_for_element("Produit")` → attend
3. `assert_visible("Produit #123")` → verifie

---

## Flow 11 — Test multi-plateforme

### Prompt
```
Teste le login sur iOS et Android :
1. Selectionne l'iPhone, teste le login
2. Selectionne le Pixel, teste le meme login
3. Compare les resultats
```

### Ce que Claude fait
1. `set_device(iphone)` → iOS
2. Flow login + assertions
3. `set_device(pixel)` → Android
4. Meme flow + assertions
5. Compare

---

## Flow 12 — Long press

### Prompt
```
Appuie longuement sur l'element "Photo" pour voir le menu contextuel.
Verifie que "Supprimer" apparait dans le menu.
```

### Ce que Claude fait
1. `long_press(text: "Photo")`
2. `wait_for_element("Supprimer")`
3. `assert_visible("Supprimer")` → PASS

---

## Flow 13 — Audit accessibilite

### Prompt
```
Verifie l'accessibilite de l'ecran actuel et donne-moi les violations.
```

### Ce que Claude fait
1. `accessibility_audit` → analyse chaque element
2. Retourne un rapport :
   - [ERROR] Boutons sans label
   - [ERROR] Tap targets trop petits (min 44pt iOS, 48dp Android)
   - [WARNING] Images sans alt text

---

## Flow 14 — Rapport de test automatique

### Prompt
```
Demarre un rapport de test "Flow Inscription".
Teste le flow d'inscription avec un email test.
Genere le rapport.
```

### Ce que Claude fait
1. `test_report(start, name="Flow Inscription")`
2. `launch_app(...)` → **auto-enregistre** screenshot + resultat
3. `tap(...)` → **auto-enregistre**
4. `type_text(...)` → **auto-enregistre**
5. `assert_visible(...)` → **auto-enregistre** (PASS ou FAIL)
6. `test_report(end)` → genere `/tmp/phantom-report-xxx/report.md` avec TOUS les screenshots

Chaque action est automatiquement tracee — pas besoin d'appeler `step` manuellement.

---

## Flow 15 — Regression visuelle

### Prompt
```
Prends un snapshot de l'ecran d'accueil comme reference.
Fais une modification dans l'app.
Compare avec le snapshot pour detecter les differences.
```

### Ce que Claude fait
1. `visual_diff(snapshot, name="accueil")`
2. ... modification de l'app ...
3. `visual_diff(compare, name="accueil")` → retourne le % de diff et les zones modifiees

---

## Flow 16 — Multi-device simultane

### Prompt
```
Lance l'app sur l'iPhone et le Pixel en meme temps,
puis prends un screenshot des deux.
```

### Ce que Claude fait
1. `multi_device(device_ids: [iphone_id, pixel_id], action="launch_app", bundle_id="com.monapp")`
2. `multi_device(device_ids: [iphone_id, pixel_id], action="screenshot")`
3. Retourne les 2 screenshots cote a cote

---

## Astuces

### Combiner les flows
```
Teste inscription, puis login, puis recherche.
Donne-moi un rapport avec les bugs trouves.
```

### Adapter le bundle ID
```bash
# Expo
cat app.json | grep bundleIdentifier
cat app.json | grep package
```
