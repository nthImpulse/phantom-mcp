import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAllDevices, getActiveDevice, formatDeviceList } from "../utils/device-manager.js";

export function registerListDevices(server: McpServer): void {
  server.tool(
    "list_devices",
    "Liste tous les devices disponibles — simulateurs iOS, émulateurs Android, et vrais devices connectés. Affiche la plateforme et l'état de chaque device.",
    {},
    async () => {
      const devices = await getAllDevices();
      const active = await getActiveDevice();
      let text = formatDeviceList(devices);

      if (active) {
        text += `\n\n**Device actif : ${active.name}** (${active.platform} ${active.type})`;
      }

      return { content: [{ type: "text", text }] };
    }
  );
}
