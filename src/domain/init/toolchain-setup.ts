import path from "path";
import { isWindows } from "../../base/platform.js";
import { joinedWithAnd } from "../../base/strings.js";
import { samePath } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { ServerFinder } from "../runner/server-finder.js";
import { RojoServer } from "../runner/rojo-server.js";
import { ToolLocator } from "../toolchain/tool-locator.js";
import { ToolManifest } from "../toolchain/tool-manifest.js";
import { Darklua } from "../toolchain/toolchain.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { PlannedCommand } from "./init-service.js";
import { Setup } from "./setup.js";

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
	name: RojoServer.COMMAND,
	label: "Rojo",
	repository: RojoServer.REPOSITORY,
	version: RojoServer.PINNED.toString(),
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
	/** The manager whose file is in the folder, when it isn't installed: its file stays the only one, so nothing is pinned. */
	readonly blocked?: ToolManager;
}

export interface ToolchainChoice {
	/** Pin the missing tools, installing Rokit first when there is no manager. */
	readonly install: boolean;
	/** Install Rojo's Studio plugin. */
	readonly plugin: boolean;
	/** The tools that are missing, which `install` pins. */
	readonly tools: readonly ToolPin[];
	readonly state: ToolState;
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
			file: "bash",
			args: [
				"-c",
				`set -o pipefail; curl -sSf ${ROKIT_INSTALLER}.sh | bash`,
			],
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

/** Gets the tools a project runs on installed: Rojo, and Darklua where the project uses it, pinned with the toolchain manager the machine has, or with Rokit installed first, and Rojo's Studio plugin. Pinning with a manager the user already has takes the default; Rokit and the plugin are installed only after a Yes or their flag. */
export class ToolchainSetup implements Setup<ToolchainChoice> {
	private state: Promise<ToolState> | undefined;

	private constructor(
		private readonly stateOf: () => Promise<ToolState>,
		private readonly questions: InitQuestions
	) {}

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
			readonly processService: ProcessService;
		}
	): Promise<ToolState> {
		const { finder, locator, processService } = tools;
		const manifest = manifests.find((one) =>
			samePath(path.dirname(one.file), directory)
		);
		const rojoReady =
			ToolchainSetup.isPinned(manifests) ||
			manifest?.uses(RojoServer.COMMAND) === true ||
			(await finder.find(existing, existing)).isOk();
		const own = manifest?.managerId as ToolManager | undefined;
		let manager: ToolState["manager"];
		for (const id of own ? [own] : MANAGERS) {
			if (await locator.find(id)) {
				manager = { id, manifest };
				break;
			}
		}
		const blocked = own && !manager ? own : undefined;
		let darklua: Promise<boolean> | undefined;
		return {
			rojoReady,
			manager,
			...(blocked && { blocked }),
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

	/** `stateOf` is called once, and only when a question or a plan needs it, since looking at the tools runs them. */
	static of(
		stateOf: () => Promise<ToolState>,
		questions: InitQuestions
	): ToolchainSetup {
		return new ToolchainSetup(stateOf, questions);
	}

	private loaded(): Promise<ToolState> {
		return (this.state ??= this.stateOf());
	}

	/** The tools this run pins: Rojo when it isn't ready, and Darklua when the project uses it and it isn't. */
	private async missing(state: ToolState): Promise<ToolPin[]> {
		return [
			...(state.rojoReady ? [] : [ROJO_PIN]),
			...(this.questions.usesDarklua && !(await state.darklua())
				? [DARKLUA_PIN]
				: []),
		];
	}

	async ask(): Promise<Result<ToolchainChoice | undefined, Diagnostic[]>> {
		const { questions } = this;
		const state = await this.loaded();
		const tools = await this.missing(state);
		const install =
			tools.length === 0 || state.blocked
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
			: ok({ install, plugin, tools, state });
	}

	plan(
		{ install, plugin, tools, state }: ToolchainChoice,
		builder: InitPlanBuilder
	): void {
		const { manager } = state;
		if (install && tools.length > 0)
			this.planInstall(tools, state, builder);
		else if (tools.length > 0) {
			const names = joinedWithAnd(tools.map(({ label }) => label));
			const many = tools.length > 1;
			const needs = `${many ? "are" : "is"}n't`;
			const who =
				tools.length === 1 && tools[0] === ROJO_PIN
					? "rogen serve"
					: "the project";
			const them = many ? "them" : "it";
			const adds = (id: ToolManager) =>
				tools
					.map(
						({ repository, version }) =>
							`'${id} add ${repository}@${version}'`
					)
					.join(", ");
			const pins = (id: ToolManager) =>
				id === "foreman"
					? `add ${them} to foreman.toml and run 'foreman install'`
					: `run ${adds(id)}`;
			builder.addSetup(
				state.blocked
					? `${names} ${needs} pinned in ${state.blocked}.toml, and ${state.blocked} isn't installed. Install it, then ${pins(state.blocked)}.`
					: manager
						? `${names} ${needs} pinned, and ${who} needs ${them}. To pin ${them} with ${manager.id}, ${pins(manager.id)}.`
						: `${names} ${needs} installed, and ${who} needs ${them}. Install Rokit (${ROKIT_INSTALL.command}), then run 'rokit init' and ${adds("rokit")} here.`
			);
		}
		builder.addSummary(
			"Rojo",
			[
				...(install && tools.length > 0
					? [
							`pin ${joinedWithAnd(tools.map(({ label, version }) => `${label} ${version}`))} in ${manager?.id ?? "rokit"}.toml`,
							...(manager ? [] : ["install Rokit first"]),
						]
					: tools.length > 0
						? ["not set up"]
						: ["ready"]),
				...(plugin ? ["install the Studio plugin"] : []),
			].join(", ")
		);
		if (plugin)
			builder.addCommand(
				run(RojoServer.COMMAND, ["plugin", "install"], MINUTE_MS)
			);
		else if (install)
			builder.addSetup(
				`Run '${RojoServer.PLUGIN_COMMAND}' to install Rojo's Studio plugin.`
			);
	}

	private planInstall(
		tools: readonly ToolPin[],
		{ manager }: ToolState,
		builder: InitPlanBuilder
	): void {
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
