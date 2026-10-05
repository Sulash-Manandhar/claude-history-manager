import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  addMarketplace,
  installPlugin,
  listAvailablePlugins,
  listInstalledPlugins,
  listMarketplaces,
  removeMarketplace,
  setPluginEnabled,
  uninstallPlugin,
} from "../src/lib/plugins";
import { type FakeCli, type Sandbox, createSandbox, installFakeCli } from "./helpers";

let sb: Sandbox;
let cli: FakeCli;

beforeEach(async () => {
  sb = await createSandbox();
  const installPath = join(sb.root, "plugin-install");
  await Bun.write(
    join(installPath, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo", description: "Demo plugin", author: { name: "Ada" }, homepage: "https://x.dev" }),
  );
  await Bun.write(join(installPath, "skills", "one", "SKILL.md"), "---\nname: one\n---\n");
  await Bun.write(join(installPath, "skills", "two", "SKILL.md"), "---\nname: two\n---\n");
  await mkdir(join(installPath, "agents"), { recursive: true });
  await Bun.write(join(installPath, "agents", "a.md"), "# a");

  cli = await installFakeCli(sb, {
    installed: [
      { id: "demo@market", version: "1.0.0", scope: "user", enabled: true, installPath, mcpServers: { srv: {} } },
      { id: "team@synced", version: "2.0.0", scope: "synced", enabled: true, installPath: join(sb.root, "nope") },
    ],
    available: {
      installed: [],
      available: [
        { pluginId: "demo@market", name: "demo", description: "Demo plugin", marketplaceName: "market", installCount: 5 },
        { pluginId: "lint@market", name: "lint", description: "Lints code", marketplaceName: "market", installCount: 9 },
        { pluginId: "zip@other", name: "zip", description: "Zips", marketplaceName: "other", installCount: 1 },
      ],
    },
    marketplaces: [{ name: "market", source: "github", repo: "acme/market" }],
  });
});
afterEach(() => sb.cleanup());

describe("listInstalledPlugins", () => {
  test("enriches CLI output with manifest details and component counts", async () => {
    const [demo, team] = await listInstalledPlugins(sb.paths);

    expect(demo).toMatchObject({
      id: "demo@market",
      name: "demo",
      marketplace: "market",
      description: "Demo plugin",
      author: "Ada",
      counts: { skills: 2, agents: 1, commands: 0 },
      mcpServers: ["srv"],
      isManaged: false,
    });
    expect(team).toMatchObject({ id: "team@synced", isManaged: true, description: "" });
  });
});

describe("listAvailablePlugins", () => {
  test("filters by query and marketplace, flags installed, sorts by popularity", async () => {
    const all = await listAvailablePlugins(sb.paths, { query: "", marketplace: null, limit: 10 });
    expect(all.items.map((p) => p.id)).toEqual(["lint@market", "demo@market", "zip@other"]);
    expect(all.items.find((p) => p.id === "demo@market")?.isInstalled).toBe(true);

    const searched = await listAvailablePlugins(sb.paths, { query: "LINT", marketplace: null, limit: 10 });
    expect(searched.items.map((p) => p.id)).toEqual(["lint@market"]);

    const scoped = await listAvailablePlugins(sb.paths, { query: "", marketplace: "other", limit: 10 });
    expect(scoped).toMatchObject({ total: 1, items: [{ id: "zip@other" }] });
  });
});

describe("plugin actions", () => {
  test("pass validated ids to the CLI", async () => {
    await setPluginEnabled(sb.paths, "demo@market", false);
    await setPluginEnabled(sb.paths, "demo@market", true);
    await installPlugin(sb.paths, "lint@market");
    await uninstallPlugin(sb.paths, "demo@market");

    expect(await cli.calls()).toEqual(
      expect.arrayContaining([
        "plugin disable demo@market --scope user",
        "plugin enable demo@market --scope user",
        "plugin install lint@market --scope user",
        "plugin uninstall demo@market --scope user",
      ]),
    );
  });

  test("rejects ids that could be read as CLI flags or paths", async () => {
    for (const bad of ["--help", "../x", "a b", "", "x@y@z"]) {
      await expect(installPlugin(sb.paths, bad)).rejects.toThrow("Invalid plugin id");
    }
    expect(await cli.calls()).toEqual([]);
  });

  test("surfaces the CLI's error message", async () => {
    await expect(installPlugin(sb.paths, "FAIL@market")).rejects.toThrow("simulated failure");
  });
});

describe("marketplaces", () => {
  test("adds GitHub shorthand, https and ssh git sources", async () => {
    await addMarketplace(sb.paths, "acme/plugins");
    await addMarketplace(sb.paths, "https://github.com/acme/plugins.git");
    await addMarketplace(sb.paths, "git@github.com:acme/plugins.git");
    const calls = await cli.calls();
    expect(calls).toContain("plugin marketplace add acme/plugins --scope user");
    expect(calls).toContain("plugin marketplace add https://github.com/acme/plugins.git --scope user");
    expect(calls).toContain("plugin marketplace add git@github.com:acme/plugins.git --scope user");
  });

  test("rejects local paths, http and flag-like sources", async () => {
    for (const bad of ["/etc", "../x", "http://insecure.dev/x", "--scope=project", "file:///tmp/x", "a/b/c d"]) {
      await expect(addMarketplace(sb.paths, bad)).rejects.toThrow("Enter a GitHub repo");
    }
  });

  test("lists and removes marketplaces", async () => {
    expect(await listMarketplaces(sb.paths)).toEqual([{ name: "market", source: "acme/market" }]);
    await removeMarketplace(sb.paths, "market");
    expect(await cli.calls()).toContain("plugin marketplace remove market");
  });
});
