# Contributing to phantom-mcp

Merci de t'intéresser à phantom-mcp ! Ce guide explique comment ajouter un nouveau tool, corriger un bug, ou améliorer la doc.

## Pré-requis dev

| Outil | Pour quoi |
|-------|-----------|
| Node.js 18+ | runtime |
| npm | package manager |
| TypeScript 5+ | langage |
| Xcode 15+ + simctl | tester le code iOS |
| Android SDK + adb | tester le code Android |
| Appium 3+ + xcuitest driver | iOS via WebDriverAgent |

## Setup local

```bash
git clone https://github.com/nthimpulse/phantom-mcp
cd phantom-mcp
npm install
npm run build
```

Le binaire compilé se trouve dans `build/index.js`. Pour le pointer depuis Claude Code, modifie ton `~/.claude.json` (ou équivalent) pour utiliser ton chemin local au lieu du package npm.

## Structure du repo

```
src/
  index.ts                  Point d'entrée MCP (24 tools)
  platforms/
    ios/
      simctl.ts             Wrappers pour xcrun simctl
      wda.ts                Client HTTP WebDriverAgent
    android/
      adb.ts                Wrappers pour adb
    types.ts                Types partagés (DeviceInfo, …)
  tools/                    24 tools (un fichier par tool, plus 3 utils)
  utils/
    device-manager.ts       État de session (device actif, cache)
    device-prepare.ts       Logique partagée prepare_device + auto-trigger
    keyboard-guard.ts       Logique partagée auto-dismiss keyboard
    tool-wrapper.ts         logAction + getReportSuffix (rapports auto)
    screenshot.ts           Helpers screenshot
    xml.ts                  Parsing XML utility
docs/                       LIMITATIONS.md / PATTERNS.md / FEATURE_REQUESTS.md / CHANGES_*.md
```

## Ajouter un nouveau tool

1. **Crée le fichier** dans `src/tools/<my-tool>.ts` en suivant le pattern :

```ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { ensureWdaRunning, /* ios helpers */ } from "../platforms/ios/wda.js";
import { /* android helpers */ } from "../platforms/android/adb.js";
import { logAction, getReportSuffix } from "../utils/tool-wrapper.js";

export function registerMyTool(server: McpServer): void {
  server.tool(
    "my_tool",
    "Description courte en français — visible par Claude.",
    { /* Zod schema des params */ },
    async (params) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      if (dev.platform === "ios") {
        const wda = await ensureWdaRunning(dev);
        if (!wda.ready) return { content: [{ type: "text", text: wda.message ?? "WDA indisponible." }], isError: true };
      }

      try {
        // ... ton code platform-specific ...
        const msg = `...`;
        logAction("my_tool", msg, false, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: msg + getReportSuffix() }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAction("my_tool", `Erreur: ${msg}`, true, dev.platform, dev.id, dev.name);
        return { content: [{ type: "text", text: `Erreur my_tool: ${msg}` }], isError: true };
      }
    }
  );
}
```

2. **Enregistre le tool** dans `src/index.ts` à la section sémantiquement appropriée (Device management / Observation / Interaction / etc.).

3. **Mets à jour le README** : nouveau tool dans la table "Les N tools" + bump count + bump version dans `index.ts` + `package.json`.

4. **Si le tool est cross-tool** (logique partagée par plusieurs tools), extrais-la dans `src/utils/`. Voir `device-prepare.ts` ou `keyboard-guard.ts` pour le pattern.

## Conventions

- **Naming helpers** : préfixe plateforme + verbe : `iosTap`, `iosScreenshot`, `androidTap`, etc.
- **Naming tools** : snake_case, verbe d'action : `tap`, `prepare_device`, `dismiss_keyboard`.
- **Validation inputs** : utilise `validateUdid()`, `validateBundleId()` dans les helpers `simctl.ts` et `adb.ts` avant tout `execFile`/`spawn`.
- **Sécurité shell** : jamais d'interpolation de string dans une commande shell. Toujours `execFile(args[])` ou `spawn(cmd, args[])`.
- **Best-effort** : pour les helpers de cleanup (clear_clipboard, dismiss_keyboard, etc.), avale les erreurs non-fatales. Loggue avec `console.error` mais ne throw pas.
- **Backward compat** : si tu changes un tool existant, ajoute des params optionnels avec defaults qui préservent le comportement antérieur. Documente tout changement de comportement par défaut dans le CHANGES.md.

## Tests

Le repo n'a pas encore de tests unitaires automatisés (TODO). En attendant, valide manuellement :

```bash
npm run build
# Pointe Claude Code sur ton build local et exécute les tools sur un simulateur iOS / un émulateur Android.
```

Si tu ajoutes un test manuel répétable, documente-le dans `docs/TUTORIAL.md`.

## Documentation

- **Nouveau tool** → entrée dans le README + entrée dans `docs/CHANGES_<DATE>.md`
- **Limitation découverte** → entrée dans `docs/LIMITATIONS.md` (symptôme + reproductible + workarounds)
- **Pattern d'usage utile** → entrée dans `docs/PATTERNS.md`
- **Feature request** → entrée dans `docs/FEATURE_REQUESTS.md` (priorité P0/P1/P2 + use case réel)

## Commit & PR

- Branche feature : `feat/<short-name>` ou `fix/<short-name>`
- Commit messages : impératif présent ("fix", "add", "refactor"), une ligne courte + explication ci-dessous si besoin
- PR : titre clair + body via le template `docs/CHANGES_<DATE>.md` style (TL;DR, pourquoi, comportements nouveaux, internals)
- Vérifier que `tsc --noEmit` passe avant push

## Licence

En contribuant, tu acceptes que ton code soit publié sous la licence du projet (voir `LICENSE`).

## Questions

Ouvre une issue avec le tag `question`. Pour les bugs : `bug` + repro steps + version Node/Xcode/Android SDK utilisée.
