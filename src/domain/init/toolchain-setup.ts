import path from "path";
import { isWindows } from "../../base/platform.js";
import { joinedWithAnd } from "../../base/strings.js";
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

/** The managers, in the order a folder with none of their files picks one. */
const MANAGERS = ["rokit", "aftman", "foreman"] as const;

type ToolManager = (typeof MANAGERS)[number];

/** A tool a toolchain manager pins. */
interface ToolPin {
	readonly name: string;
	readonly label: string;
	readonly repository: string;
	readonly version: string;
}

const ROJO_PIN: ToolPin = {
	name: RojoServer.COMMAND,
	label: "Rojo",
	repository: RojoServer.REPOSITORY,
	version: RojoServer.PINNED.toString(),
};

/** How the tools the project needs stand. */
export interface ToolState {
	/** Rojo runs, or a toolchain file there or above pins it. */
	readonly rojoReady: boolean;
	/** The manager whose file takes the pins: the one whose file is in the folder, else the first one on the machine, else Rokit. */
	readonly manager: {
		readonly id: ToolManager;
		/** The manager's file in the project's folder, when it has one. */
		readonly manifest?: ToolManifest;
		/** Whether the manager runs on this machine. */
		readonly installed: boolean;
	};
}

export interface ToolchainChoice {
	/** The tools that are missing, which the plan pins. */
	readonly tools: readonly ToolPin[];
	readonly state: ToolState;
}

/** Rokit's own installer for the OS, which is printed and never run. */
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

/** Writes Rojo's pin into the toolchain file of the manager the machine has, when Rojo isn't ready. It runs nothing and installs nothing; the next step names the command to run. */
export class ToolchainSetup implements Setup<ToolchainChoice> {
	private state: Promise<ToolState> | undefined;

	private constructor(private readonly stateOf: () => Promise<ToolState>) {}

	/** Whether a toolchain file in `manifests` already pins Rojo. */
	static isPinned(manifests: readonly ToolManifest[]): boolean {
		return manifests.some((manifest) =>
			manifest.nameOf(RojoServer.REPOSITORY)
		);
	}

	/** How things stand in `directory`, whose first existing folder up, `existing`, is where the tools are asked for their version. */
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

	/** `stateOf` is called once, and only when a plan needs it, since looking at the tools runs them. */
	static of(stateOf: () => Promise<ToolState>): ToolchainSetup {
		return new ToolchainSetup(stateOf);
	}

	private loaded(): Promise<ToolState> {
		return (this.state ??= this.stateOf());
	}

	async ask(): Promise<Result<ToolchainChoice | undefined, Diagnostic[]>> {
		const state = await this.loaded();
		return ok({ tools: state.rojoReady ? [] : [ROJO_PIN], state });
	}

	plan({ tools, state }: ToolchainChoice, builder: InitPlanBuilder): void {
		const { id, manifest, installed } = state.manager;
		if (tools.length === 0) {
			builder.addSummary("Rojo", "ready");
			return;
		}
		const file = `${id}.toml`;
		let pinned = manifest ?? ToolManifest.parse(file, "")!;
		let content = "";
		for (const tool of tools) {
			content = pinned.withPin(tool.name, tool.repository, tool.version);
			pinned = ToolManifest.parse(file, content)!;
		}
		builder.addToolManifest({
			fileName: file,
			content,
			...(manifest && {
				addition: `${joinedWithAnd(tools.map(({ label }) => `${label}'s`))} pin`,
			}),
		});
		builder.addSummary(
			"Rojo",
			`pin ${joinedWithAnd(tools.map(({ label, version }) => `${label} ${version}`))} in ${file}`
		);
		const { label, page } = MANAGER_COPY[id];
		builder.addSetup(
			installed
				? `Run '${id} install' to install ${joinedWithAnd(tools.map(({ label: name }) => name))}.`
				: id === "rokit"
					? `Install Rokit with '${ROKIT_INSTALL}' (${page}), then run 'rokit install' here.`
					: `Install ${label} (${page}), then run '${id} install' here.`
		);
		builder.addSetup(
			`Run '${RojoServer.PLUGIN_COMMAND}' to install Rojo's Studio plugin.`
		);
	}
}
