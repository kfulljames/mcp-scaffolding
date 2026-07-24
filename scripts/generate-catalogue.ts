import { mkdir, writeFile } from "node:fs/promises";
import { ToolRegistry } from "../src/server/tool-registry.js";
import { searchOpenHighPriorityTickets } from "../examples/read-tool.js";
import { closeTicket } from "../examples/write-tool.js";
import { listTickets } from "../examples/paginated-tool.js";

/**
 * Generates the tool catalogue and permission manifest FROM tool metadata —
 * never hand-written, per SPEC.md §13 definition-of-done. Run via
 * `npm run generate:catalogue`; wired into CI (.github/workflows/ci.yml) so
 * a tool whose metadata changes always produces a fresh, committable
 * artifact rather than a stale hand-maintained doc.
 *
 * Swap the three example imports for your real tool modules once this
 * template has real tools — see docs/ADDING-A-TOOL.md.
 */
async function main(): Promise<void> {
  const registry = new ToolRegistry().registerAll([
    searchOpenHighPriorityTickets,
    closeTicket,
    listTickets,
  ]);

  await mkdir("generated", { recursive: true });
  await writeFile(
    "generated/tool-catalogue.json",
    JSON.stringify(registry.generateCatalogue(), null, 2) + "\n",
  );
  await writeFile(
    "generated/permission-manifest.json",
    JSON.stringify(registry.generatePermissionManifest(), null, 2) + "\n",
  );
  await writeFile(
    "generated/presets.json",
    JSON.stringify(registry.derivePresets(), null, 2) + "\n",
  );

  console.log(`Generated catalogue for ${registry.all().length} tools -> generated/`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
