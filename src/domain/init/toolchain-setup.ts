import path from "path";
import { isWindows } from "../../base/platform.js";
import { samePath } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ServerFinder } from "../runner/server-finder.js";
import { SyncServer } from "../runner/sync-server.js";
import { ToolLocator } from "../toolchain/tool-locator.js";
import { ToolManifest } from "../toolchain/tool-manifest.js";
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

/** How the tools the project needs stand: they run, a manager can pin them, or there is none. */
export type ToolState =
	| { readonly kind: "ready" }
	| {
			readonly kind: "manager";
			readonly manager: ToolManager;
			/** The manager's file in the project's folder, when it has one. */
			readonly manifest?: ToolManifest;
	  }
	| { readonly kind: "nothing" };

export interface ToolchainChoice {
	/** Pin the tools, installing Rokit first when there is no manager. */
	readonly install: boolean;
	/** Install Rojo's Studio plugin. */
	readonly plugin: boolean;
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

/** Gets the tools a project runs on installed: Rojo, pinned with the toolchain manager the machine has, or with Rokit installed first, and Rojo's Studio plugin. A tool is never installed without a Yes or its flag. */
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

	/** How things stand in `directory`, whose first existing folder up is where Rojo is asked for its version. */
	static async stateOf(
		directory: string,
		manifests: readonly ToolManifest[],
		finder: ServerFinder,
		locator: ToolLocator,
		existing: string
	): Promise<ToolState> {
		if (ToolchainSetup.isPinned(manifests)) return { kind: "ready" };
		if ((await finder.find(existing, existing)).isOk())
			return { kind: "ready" };
		const manifest = manifests.find((one) =>
			samePath(path.dirname(one.file), directory)
		);
		if (manifest?.uses(ROJO_NAME)) return { kind: "ready" };
		const own = manifest?.managerId as ToolManager | undefined;
		for (const manager of own ? [own] : MANAGERS)
			if (await locator.find(manager))
				return { kind: "manager", manager, manifest };
		return { kind: "nothing" };
	}

	static of(
		state: ToolState,
		questions: InitQuestions
	): ToolchainSetup | undefined {
		const { choices } = questions;
		return state.kind === "ready" && choices.plugin === undefined
			? undefined
			: new ToolchainSetup(state, questions);
	}

	/** The same setup for a run that chose to set Rojo up, which asks about the plugin only. */
	asked(): Setup<ToolchainChoice> {
		return {
			ask: async () => {
				const plugin = await this.questions.studioPlugin();
				return ok(
					plugin === undefined ? undefined : { install: true, plugin }
				);
			},
			plan: (choice, builder) => this.plan(choice, builder),
		};
	}

	async ask(): Promise<Result<ToolchainChoice | undefined, Diagnostic[]>> {
		const { state, questions } = this;
		const install =
			state.kind === "ready"
				? false
				: await questions.rojo(
						state.kind === "nothing" ? undefined : state.manager,
						ROKIT_INSTALL.command
					);
		if (install === undefined) return ok(undefined);
		const plugin =
			install || questions.choices.plugin !== undefined
				? await questions.studioPlugin()
				: false;
		return plugin === undefined ? ok(undefined) : ok({ install, plugin });
	}

	plan({ install, plugin }: ToolchainChoice, builder: InitPlanBuilder): void {
		const { state } = this;
		if (install && state.kind !== "ready") this.planInstall(state, builder);
		else if (state.kind === "nothing")
			builder.addSetup(
				`Rojo isn't installed, and rogen serve needs it. Run 'rogen init --rojo' to install Rokit and Rojo, or install Rokit yourself (${ROKIT_INSTALL.command}), then run 'rokit init' and 'rokit add ${SyncServer.ROJO.repository}@${SyncServer.ROJO.pinned}' here.`
			);
		else if (state.kind === "manager")
			builder.addSetup(
				`Rojo isn't pinned, and rogen serve needs it. Run 'rogen init --rojo' to pin it with ${state.manager}.`
			);
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
		state: Exclude<ToolState, { kind: "ready" }>,
		builder: InitPlanBuilder
	): void {
		const server = SyncServer.ROJO;
		const spec = `${server.repository}@${server.pinned}`;
		const manager = state.kind === "manager" ? state.manager : "rokit";
		const file = `${manager}.toml`;
		if (state.kind === "nothing") builder.addCommand({ ...ROKIT_INSTALL });
		if (manager === "foreman") {
			const manifest =
				state.kind === "manager" && state.manifest
					? state.manifest
					: ToolManifest.parse(file, "")!;
			builder.addToolManifest({
				fileName: file,
				content: manifest.withPin(
					ROJO_NAME,
					server.repository,
					server.pinned.toString()
				),
				...(state.kind === "manager" &&
					state.manifest && { addition: `${server.name}'s pin` }),
			});
			builder.addCommand(run("foreman", ["install"]));
			return;
		}
		if (!(state.kind === "manager" && state.manifest))
			builder.addToolManifest({ fileName: file, content: "[tools]\n" });
		builder.addCommand(run(manager, ["add", spec]));
	}
}
