import path from "path";
import { isWindows } from "../../base/platform.js";
import { samePath } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ServerFinder } from "../runner/server-finder.js";
import { RojoServer } from "../runner/rojo-server.js";
import { ToolLocator } from "../toolchain/tool-locator.js";
import { ToolManifest } from "../toolchain/tool-manifest.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { Setup } from "./setup.js";

const ROKIT_INSTALLER =
	"https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install";

const MANAGERS = ["rokit", "aftman", "foreman"] as const;

type ToolManager = (typeof MANAGERS)[number];

export interface ToolState {
	readonly rojoReady: boolean;
	readonly manager: {
		readonly id: ToolManager;
		readonly manifest?: ToolManifest;
		readonly installed: boolean;
	};
}

const ROKIT_INSTALL = isWindows
	? `Invoke-RestMethod ${ROKIT_INSTALLER}.ps1 | Invoke-Expression`
	: `curl -sSf ${ROKIT_INSTALLER}.sh | bash`;

const MANAGER_COPY: Readonly<
	Record<ToolManager, { readonly label: string; readonly page: string }>
> = {
	rokit: { label: "Rokit", page: "https://github.com/rojo-rbx/rokit" },
	aftman: { label: "Aftman", page: "https://github.com/LPGhatguy/aftman" },
	foreman: { label: "Foreman", page: "https://github.com/Roblox/foreman" },
};

export class ToolchainSetup implements Setup<ToolState> {
	constructor(private readonly stateOf: () => Promise<ToolState>) {}

	static isPinned(manifests: readonly ToolManifest[]): boolean {
		return manifests.some((manifest) =>
			manifest.nameOf(RojoServer.REPOSITORY)
		);
	}

	static async stateOf(
		directory: string,
		manifests: readonly ToolManifest[],
		existing: string,
		tools: {
			readonly finder: ServerFinder;
			readonly locator: ToolLocator;
		}
	): Promise<ToolState> {
		const { finder, locator } = tools;
		const manifest = manifests.find((one) =>
			samePath(path.dirname(one.file), directory)
		);
		const rojoReady =
			ToolchainSetup.isPinned(manifests) ||
			manifest?.uses(RojoServer.COMMAND) === true ||
			(await finder.find(existing, existing)).isOk();
		const own = manifest?.managerId as ToolManager | undefined;
		let found: ToolManager | undefined;
		for (const id of own ? [own] : MANAGERS) {
			if (await locator.find(id)) {
				found = id;
				break;
			}
		}
		const id = found ?? own ?? "rokit";
		return {
			rojoReady,
			manager: { id, manifest, installed: found !== undefined },
		};
	}

	async ask(): Promise<Result<ToolState | undefined, Diagnostic[]>> {
		return ok(await this.stateOf());
	}

	plan({ rojoReady, manager }: ToolState, builder: InitPlanBuilder): void {
		const { id, manifest, installed } = manager;
		if (rojoReady) {
			builder.addSummary("Rojo", "ready");
			return;
		}
		const file = `${id}.toml`;
		const version = RojoServer.PINNED.toString();
		builder.addToolManifest({
			fileName: file,
			content: (manifest ?? ToolManifest.parse(file, "")!).withPin(
				RojoServer.COMMAND,
				RojoServer.REPOSITORY,
				version
			),
			...(manifest && { addition: "Rojo's pin" }),
		});
		builder.addSummary("Rojo", `pin Rojo ${version} in ${file}`);
		const { label, page } = MANAGER_COPY[id];
		builder.addSetup(
			installed
				? `Run '${id} install' to install Rojo.`
				: id === "rokit"
					? `Install Rokit with '${ROKIT_INSTALL}' (${page}), then run 'rokit install' here.`
					: `Install ${label} (${page}), then run '${id} install' here.`
		);
		builder.addSetup(
			`Run '${RojoServer.PLUGIN_COMMAND}' to install Rojo's Studio plugin.`
		);
	}
}
