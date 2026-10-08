import { PlannedFile } from "../toolchain/toolchain.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { agentHook } from "./agent-hook.js";
import { HookRegistration } from "./hook-registration.js";
import { HOOK_SCRIPT_FILE, HookTarget } from "./hook-target.js";

/** An agent found in the project, and the text of its hook file if it has one. */
export interface AgentInUse {
	readonly target: HookTarget;
	readonly text: string | undefined;
}

/** What `init` finds of the hook in a directory. */
export interface AgentHooksState {
	/** Whether the script is there already, which `init` never writes over. */
	readonly scriptExists: boolean;
	readonly inUse: readonly AgentInUse[];
}

/** The Stop hook that reports Rogen warnings about the files a turn changed, and what it takes to register it with each agent in use. */
export class AgentHooks {
	private readonly registrations: readonly {
		readonly target: HookTarget;
		readonly registration: HookRegistration;
		/** Whether the agent's hook file is there to add to. */
		readonly existed: boolean;
	}[];

	constructor(private readonly state: AgentHooksState) {
		this.registrations = state.inUse.map(({ target, text }) => ({
			target,
			registration: target.register(text),
			existed: text !== undefined,
		}));
	}

	private get registering() {
		return this.registrations.flatMap(
			({ target, registration, existed }) =>
				registration.kind === "added"
					? [{ target, text: registration.text, existed }]
					: []
		);
	}

	/** Whether to offer it: some agent in use still needs the hook registered. */
	get offered(): boolean {
		return this.registering.length > 0;
	}

	/** The agents it registers with. */
	get agents(): string[] {
		return this.registering.map(({ target }) => target.name);
	}

	/** The script unless it's there, then each agent's file with the hook registered. */
	get files(): PlannedFile[] {
		return [
			...(this.state.scriptExists
				? []
				: [{ fileName: HOOK_SCRIPT_FILE, content: agentHook }]),
			...this.registering.map(({ target, text, existed }) => ({
				fileName: target.settingsFile,
				content: text,
				...(existed && { appends: true, summary: "the Rogen hook" }),
			})),
		];
	}

	/** A file `init` left alone for a reason the user can act on. */
	get notes(): string[] {
		return this.registrations.flatMap(({ target, registration }) =>
			registration.kind === "unreadable"
				? [
						`${target.settingsFile} isn't plain JSON, so it was left alone. Register ${HOOK_SCRIPT_FILE} in it by hand: ${DOCS_URL}/agents`,
					]
				: []
		);
	}

	/** What the hook needs of the machine, and what an agent asks of the user. */
	get setup(): string[] {
		return [
			"The hook needs bash, git and jq; on Windows, winget install jqlang.jq.",
			...this.registering.flatMap(({ target }) =>
				target.afterwards ? [target.afterwards] : []
			),
		];
	}
}
