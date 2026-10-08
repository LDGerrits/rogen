import { PlannedFile } from "../toolchain/toolchain.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { agentHook } from "./agent-hook.js";
import { HOOK_SCRIPT_FILE, HookTarget, registerHook } from "./hook-target.js";

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
	/** The agents it still has to be registered with, and their hook files with it registered. */
	private readonly registering: readonly {
		readonly target: HookTarget;
		readonly text: string;
		/** Whether the agent's hook file is there to add to. */
		readonly existed: boolean;
	}[];
	/** The agents whose hook file isn't plain JSON, so it can't be added to. */
	private readonly unreadable: readonly HookTarget[];

	constructor(private readonly state: AgentHooksState) {
		const registrations = state.inUse.map(({ target, text }) => ({
			target,
			registration: registerHook(text, target.hook),
			existed: text !== undefined,
		}));
		this.registering = registrations.flatMap(
			({ target, registration, existed }) =>
				registration.kind === "added"
					? [{ target, text: registration.text, existed }]
					: []
		);
		this.unreadable = registrations.flatMap(({ target, registration }) =>
			registration.kind === "unreadable" ? [target] : []
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
				...(existed && { addition: "the Rogen hook" }),
			})),
		];
	}

	/** A file `init` left alone for a reason the user can act on. */
	get notes(): string[] {
		return this.unreadable.map(
			({ settingsFile }) =>
				`${settingsFile} isn't plain JSON, so it was left alone. Register ${HOOK_SCRIPT_FILE} in it by hand: ${DOCS_URL}/agents`
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
