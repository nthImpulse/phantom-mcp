import { z } from "zod";
import { mkdir, writeFile, readFile, access } from "fs/promises";
import { PNG } from "pngjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDevice } from "../utils/device-manager.js";
import { takeScreenshot } from "../utils/screenshot.js";

const SNAPSHOT_DIR = "/tmp/phantom-snapshots";
const MAX_SNAPSHOTS = 20;
const referenceSnapshots = new Map<string, Buffer>();

function evictOldestSnapshot(): void {
  if (referenceSnapshots.size >= MAX_SNAPSHOTS) {
    const oldest = referenceSnapshots.keys().next().value;
    if (oldest !== undefined) {
      referenceSnapshots.delete(oldest);
      console.error(`[phantom] Snapshot cache full — evicted "${oldest}"`);
    }
  }
}

function decodePng(buffer: Buffer): PNG {
  return PNG.sync.read(buffer);
}

function comparePixels(ref: PNG, current: PNG): { diffCount: number; totalPixels: number; grid: number[][] } {
  const width = ref.width;
  const height = ref.height;
  const totalPixels = width * height;
  let diffCount = 0;

  // 8x8 grid for region detection
  const gridCols = 8;
  const gridRows = 8;
  const grid: number[][] = Array.from({ length: gridRows }, () => Array(gridCols).fill(0));
  const cellW = Math.ceil(width / gridCols);
  const cellH = Math.ceil(height / gridRows);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dr = Math.abs(ref.data[idx] - current.data[idx]);
      const dg = Math.abs(ref.data[idx + 1] - current.data[idx + 1]);
      const db = Math.abs(ref.data[idx + 2] - current.data[idx + 2]);

      // Pixel is "different" if color distance > threshold
      if (dr + dg + db > 30) {
        diffCount++;
        const gx = Math.min(Math.floor(x / cellW), gridCols - 1);
        const gy = Math.min(Math.floor(y / cellH), gridRows - 1);
        grid[gy][gx]++;
      }
    }
  }

  return { diffCount, totalPixels, grid };
}

function formatGrid(grid: number[][], cellW: number, cellH: number): string {
  const hotCells: string[] = [];
  for (let gy = 0; gy < grid.length; gy++) {
    for (let gx = 0; gx < grid[gy].length; gx++) {
      const cellPixels = cellW * cellH;
      const pct = (grid[gy][gx] / cellPixels) * 100;
      if (pct > 5) {
        hotCells.push(`zone (${gx * cellW},${gy * cellH}) : ${pct.toFixed(1)}% change`);
      }
    }
  }
  return hotCells.length > 0
    ? `Zones modifiees :\n${hotCells.map((c) => `  - ${c}`).join("\n")}`
    : "Aucune zone majeure modifiee.";
}

export function registerVisualDiff(server: McpServer): void {
  server.tool(
    "visual_diff",
    "Compare deux screenshots pour detecter des regressions visuelles. action='snapshot' pour sauver une reference, action='compare' pour comparer avec la reference.",
    {
      action: z.enum(["snapshot", "compare"]).describe("'snapshot' pour sauver, 'compare' pour comparer"),
      name: z.string().optional().default("default").describe("Nom du snapshot (defaut: 'default')"),
      threshold: z.number().min(0).max(100).optional().default(0.1).describe("Seuil de diff en % pour considerer PASS (defaut: 0.1)"),
    },
    async ({ action, name, threshold }) => {
      const result = await resolveDevice();
      if ("error" in result) return { content: [{ type: "text", text: result.error }], isError: true };
      const dev = result.device;

      try {
        if (action === "snapshot") {
          const buffer = await takeScreenshot(dev.platform, dev.id);
          evictOldestSnapshot();
          referenceSnapshots.set(name, buffer);

          // Persist to disk
          await mkdir(SNAPSHOT_DIR, { recursive: true });
          await writeFile(`${SNAPSHOT_DIR}/${name}.png`, buffer);

          const png = decodePng(buffer);
          return {
            content: [{ type: "text", text: `Snapshot "${name}" sauve (${png.width}x${png.height}). Utilise action='compare' pour comparer plus tard.` }],
          };
        }

        // --- COMPARE ---
        // Get reference
        let refBuffer = referenceSnapshots.get(name);
        if (!refBuffer) {
          // Try loading from disk
          const diskPath = `${SNAPSHOT_DIR}/${name}.png`;
          const diskExists = await access(diskPath).then(() => true).catch(() => false);
          if (diskExists) {
            refBuffer = await readFile(diskPath);
            referenceSnapshots.set(name, refBuffer);
          } else {
            return { content: [{ type: "text", text: `Aucun snapshot "${name}". Utilise action='snapshot' d'abord.` }], isError: true };
          }
        }

        // Take current screenshot
        const currentBuffer = await takeScreenshot(dev.platform, dev.id);

        // Decode both
        const refPng = decodePng(refBuffer);
        const currentPng = decodePng(currentBuffer);

        // Size check
        if (refPng.width !== currentPng.width || refPng.height !== currentPng.height) {
          return {
            content: [{
              type: "text",
              text: `FAIL — Tailles differentes : reference ${refPng.width}x${refPng.height} vs actuel ${currentPng.width}x${currentPng.height}. Device ou orientation differente ?`,
            }],
            isError: true,
          };
        }

        // Compare
        const { diffCount, totalPixels, grid } = comparePixels(refPng, currentPng);
        const diffPct = (diffCount / totalPixels) * 100;
        const pass = diffPct <= threshold;

        const cellW = Math.ceil(refPng.width / 8);
        const cellH = Math.ceil(refPng.height / 8);

        const lines = [
          `Visual Diff : "${name}"`,
          `Reference : ${refPng.width}x${refPng.height}`,
          `Pixels differents : ${diffCount.toLocaleString()} / ${totalPixels.toLocaleString()} (${diffPct.toFixed(3)}%)`,
          `Seuil : ${threshold}%`,
          `Resultat : ${pass ? "PASS" : "FAIL"}`,
          "",
          formatGrid(grid, cellW, cellH),
        ];

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          isError: !pass,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Erreur visual_diff: ${msg}` }], isError: true };
      }
    }
  );
}
