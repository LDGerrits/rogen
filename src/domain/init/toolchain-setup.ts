import path from "path";
import { isWindows } from "../../base/platform.js";
import { joinedWithAnd } from "../../base/strings.js";
import { samePath } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { ServerFinder } from "../runner/server-finder.js";
import { SyncServer } from "../runner/sync-server.js";
import { ToolLocator } from "../toolchain/tool-locator.js";
import { ToolManifest } from "../toolchain/tool-manifest.js";
import { Darklua } from "../toolchain/toolchain.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { PlannedCommand } from "./init-service.js";
import { Setup } from "./setup.js";

const ROJO_NAME = "rojo";

const ROKIT_INSTALLER =
	"https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install";

/** The managers, in the order a folder with none of their files picks one. */
const MANAGERS = ["rokit", "aftman", "foreman"] as const;

export type ToolManager = (typeof MANAGERS)[number];

const MINUTE_MS = 60_000;

/** A tool a toolchain manager pins. */
export interface ToolPin {
	readonly name: string;
	readonly label: string;
	readonly repository: string;
	readonly version: string;
}

const ROJO_PIN: ToolPin = {
	name: ROJO_NAME,
	label: SyncServer.ROJO.name,
	repository: SyncServer.ROJO.repository,
	version: SyncServer.ROJO.pinned.toString(),
};

const DARKLUA_PIN: ToolPin = {
	name: "darklua",
	label: "Darklua",
	repository: Darklua.REPOSITORY,
	version: Darklua.PINNED,
};

/** How the tools the project needs stand. */
export interface ToolState {
	/** Rojo runs, or a toolchain file there or above pins it. */
	readonly rojoReady: boolean;
	/** Whether Darklua is pinned or runs, which is only looked at once the project is known to use it. */
	readonly darklua: () => Promise<boolean>;
	/** The manager that pins tools here: the one whose file is in the folder, else the first one on the machine; none means Rokit has to be installed. */
	readonly manager?: {
		readonly id: ToolManager;
		/** The manager's file in the project's folder, when it has one. */
		readonly manifest?: ToolManifest;
	};
}

export interface ToolchainChoice {
	/** Pin the missing tools, installing Rokit first when there is no manager. */
	readonly install: boolean;
	/** Install Rojo's Studio plugin. */
	readonly plugin: boolean;
	/** The tools that are missing, which `install` pins. */
	readonly tools: readonly ToolPin[];
}

/** Rokit's own installer, for the OS. */
export const ROKIT_INSTALL: Pick<
	PlannedCommand,
	"command" | "file" | "args" | "timeout"
> = isWindows
	? {
			command: `Invoke-RestMethod ${ROKIT_INSTALLER}.ps1 | Invoke-Expression`,
			file: "powershell",
			args: [
				"-NoProfile",
				"-Command",
				`Invoke-RestMethod ${ROKIT_INSTALLER}.ps1 | Invoke-Expression`,
			],
			timeout: 2 * MINUTE_MS,
		}
	: {
			command: `curl -sSf ${ROKIT_INSTALLER}.sh | bash`,
			file: "sh",
			args: ["-c", `curl -sSf ${ROKIT_INSTALLER}.sh | bash`],
			timeout: 2 * MINUTE_MS,
		};

const run = (
	file: string,
	args: readonly string[],
	timeout = 2 * MINUTE_MS
): PlannedCommand => ({
	command: [file, ...args].join(" "),
	file,
	args,
	timeout,
});

/** Gets the tools a project runs on installed: Rojo, and Darklua where the project uses it, pinned with the toolchain manager the machine has, or with Rokit installed first, and Rojo's Studio plugin. A tool is never installed without a Yes or its flag. */
export class ToolchainSetup implements Setup<ToolchainChoice> {
	private constructor(
		private readonly state: ToolState,
		private readonly questions: InitQuestions
	) {}

	/** Whether a toolchain file in `manifests` already pins Rojo. */
	static isPinned(manifests: readonly ToolManifest[]): boolean {
		return manifests.some((manifest) =>
			manifest.nameOf(SyncServer.ROJO.repository)
		);
	}

	/** The toolchain file in `manifests` that pins Rojo. */
	static pinnedIn(manifests: readonly ToolManifest[]): string | undefined {
		return manifests.find((one) => one.nameOf(SyncServer.ROJO.repository))
			?.file;
	}

	/** How things stand in `directory`, whose first existing folder up, `existing`, is where the tools are asked for their version. */
	static async stateOf(
		directory: string,
		manifests: readonly ToolManifest[],
		existing: string,
		tools: {
			readonly finder: ServerFinder;
			readonly locator: ToolLocator;
			readonly processService: ProcessService;
		}
	): Promise<ToolState> {
		const { finder, locator, processService } = tools;
		const manifest = manifests.find((one) =>
			samePath(path.dirname(one.file), directory)
		);
		const rojoReady =
			ToolchainSetup.isPinned(manifests) ||
			manifest?.uses(ROJO_NAME) === true ||
			(await finder.find(existing, existing)).isOk();
		const own = manifest?.managerId as ToolManager | undefined;
		let manager: ToolState["manager"];
		for (const id of own ? [own] : MANAGERS) {
			if (await locator.find(id)) {
				manager = { id, manifest };
				break;
			}
		}
		let darklua: Promise<boolean> | undefined;
		return {
			rojoReady,
			manager,
			darklua: () =>
				(darklua ??= (async () => {
					if (manifests.some((one) => one.nameOf(Darklua.REPOSITORY)))
						return true;
					const file = await locator.find("darklua");
					if (!file) return false;
					const ran = await processService.exec(file, ["--version"], {
						cwd: existing,
						timeout: MINUTE_MS,
					});
					return ran.isOk() && ran.value.code === 0;
				})()),
		};
	}

	static of(state: ToolState, questions: InitQuestions): ToolchainSetup {
		return new ToolchainSetup(state, questions);
	}

	/** Whether Rojo has to be set up, which a folder that has a config is offered. */
	get rojoMissing(): boolean {
		return !this.state.rojoReady;
	}

	/** The tools this run pins: Rojo when it isn't ready, and Darklua when the project uses it and it isn't. */
	private async missing(): Promise<ToolPin[]> {
		return [
			...(this.state.rojoReady ? [] : [ROJO_PIN]),
			...(this.questions.usesDarklua && !(await this.state.darklua())
				? [DARKLUA_PIN]
				: []),
		];
	}

	/** The same setup for a run that chose to set Rojo up, which asks about the plugin only. */
	asked(): Setup<ToolchainChoice> {
		return {
			ask: async () => {
				const plugin = await this.questions.studioPlugin();
				return ok(
					plugin === undefined
						? undefined
						: {
								install: true,
								plugin,
								tools: await this.missing(),
							}
				);
			},
			plan: (choice, builder) => this.plan(choice, builder),
		};
	}

	async ask(): Promise<Result<ToolchainChoice | undefined, Diagnostic[]>> {
		const { state, questions } = this;
		const tools = await this.missing();
		const install =
			tools.length === 0
				? false
				: await questions.rojo(
						state.manager?.id,
						ROKIT_INSTALL.command,
						tools.map(({ label, version }) => `${label} ${version}`)
					);
		if (install === undefined) return ok(undefined);
		const plugin =
			install || questions.choices.plugin !== undefined
				? await questions.studioPlugin()
				: false;
		return plugin === undefined
			? ok(undefined)
			: ok({ install, plugin, tools });
	}

	plan(
		{ install, plugin, tools }: ToolchainChoice,
		builder: InitPlanBuilder
	): void {
		const { manager } = this.state;
		if (install && tools.length > 0) this.planInstall(tools, builder);
		else if (tools.length > 0) {
			const names = joinedWithAnd(tools.map(({ label }) => label));
			const many = tools.length > 1;
			const needs = `${many ? "are" : "is"}n't`;
			const who =
				tools.length === 1 && tools[0] === ROJO_PIN
					? "rogen serve"
					: "the project";
			builder.addSetup(
				manager
					? `${names} ${needs} pinned, and ${who} needs ${many ? "them" : "it"}. Run 'rogen init --rojo' to pin ${many ? "them" : "it"} with ${manager.id}.`
					: `${names} ${needs} installed, and ${who} needs ${many ? "them" : "it"}. Run 'rogen init --rojo' to install Rokit and ${names}, or install Rokit yourself (${ROKIT_INSTALL.command}), then run 'rokit init' and ${tools.map(({ repository, version }) => `'rokit add ${repository}@${version}'`).join(", ")} here.`
			);
		}
		if (plugin)
			builder.addCommand(
				run(ROJO_NAME, ["plugin", "install"], MINUTE_MS)
			);
		else if (install)
			builder.addSetup(
				`Run '${SyncServer.ROJO.pluginCommand}' to install Rojo's Studio plugin.`
			);
	}

	private planInstall(
		tools: readonly ToolPin[],
		builder: InitPlanBuilder
	): void {
		const { manager } = this.state;
		const id = manager?.id ?? "rokit";
		const file = `${id}.toml`;
		if (!manager) builder.addCommand({ ...ROKIT_INSTALL });
		if (id === "foreman") {
			let manifest = manager?.manifest ?? ToolManifest.parse(file, "")!;
			let content = "";
			for (const tool of tools) {
				content = manifest.withPin(
					tool.name,
					tool.repository,
					tool.version
				);
				manifest = ToolManifest.parse(file, content)!;
			}
			builder.addToolManifest({
				fileName: file,
				content,
				...(manager?.manifest && {
					addition: `${joinedWithAnd(tools.map(({ label }) => `${label}'s`))} pin`,
				}),
			});
			builder.addCommand(run("foreman", ["install"]));
			return;
		}
		if (!manager?.manifest)
			builder.addToolManifest({ fileName: file, content: "[tools]\n" });
		for (const tool of tools)
			builder.addCommand(
				run(id, ["add", `${tool.repository}@${tool.version}`])
			);
	}
}
