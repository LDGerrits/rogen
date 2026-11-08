import { PlannedFile } from "../../toolchain/toolchain.js";
import { DOCS_URL } from "../../../platform/product/product-service.js";
import { hookScript } from "./hook-script.js";
import { HOOK_SCRIPT_FILE, CodingAgent, withHook } from "./coding-agent.js";

export interface AgentInUse {
	readonly agent: CodingAgent;
	readonly text: string | undefined;
}

interface AgentHooksParts {
	readonly scriptExists: boolean;
	readonly inUse: readonly AgentInUse[];
}

/** How an agent's settings stand with the hook: `absent` and `added` are a new file or an edit that registers it. */
type AgentHookStatus =
	| {
			readonly agent: CodingAgent;
			readonly registration: "absent" | "added";
			readonly text: string;
	  }
	| {
			readonly agent: CodingAgent;
			readonly registration: "present" | "unreadable";
	  };

export class AgentHooks {
	private readonly statuses: readonly AgentHookStatus[];

	constructor(private readonly state: AgentHooksParts) {
		this.statuses = state.inUse.map(({ agent, text }): AgentHookStatus => {
			const registration = withHook(text, agent.hook);
			if (registration.kind !== "added")
				return { agent, registration: registration.kind };
			return {
				agent,
				registration: text === undefined ? "absent" : "added",
				text: registration.text,
			};
		});
	}

	/** Whether a coding agent whose hook file Rogen knows is in use here, whether or not it has the hook. */
	get inUse(): boolean {
		return this.state.inUse.length > 0;
	}

	/** Whether the agent whose settings live in `settingsFile` is in use here. */
	uses(settingsFile: string): boolean {
		return this.state.inUse.some(
			({ agent }) => agent.settingsFile === settingsFile
		);
	}

	get offered(): boolean {
		return this.registering.length > 0;
	}

	/** The agents in use whose hook file registers the script already, while the script exists. */
	get registered(): string[] {
		return this.state.scriptExists ? this.registeredNames : [];
	}

	/** The agents whose registered hook runs a script that is gone, which init writes back without asking. */
	get restoring(): string[] {
		return this.state.scriptExists ? [] : this.registeredNames;
	}

	get agents(): string[] {
		return this.registering.map(({ agent }) => agent.name);
	}

	/** The files that restore the script, and register the hook where `registering`. */
	files(registering: boolean): PlannedFile[] {
		const additions = registering ? this.registering : [];
		return [
			...(!this.state.scriptExists &&
			(additions.length > 0 || this.restoring.length > 0)
				? [{ fileName: HOOK_SCRIPT_FILE, content: hookScript }]
				: []),
			...additions.map(({ agent, registration, text }) => ({
				fileName: agent.settingsFile,
				content: text,
				...(registration === "added" && {
					addition: "the Rogen hook",
				}),
			})),
		];
	}

	get notes(): string[] {
		return this.statuses.flatMap(({ agent, registration }) =>
			registration === "unreadable"
				? [
						`${agent.settingsFile} isn't plain JSON, so it was left alone. Register ${HOOK_SCRIPT_FILE} in it by hand: ${DOCS_URL}/agents`,
					]
				: []
		);
	}

	get setup(): string[] {
		return [
			"The hook runs the Rogen in node_modules/.bin, else the one on the PATH; install Rogen in the project or globally.",
			...this.registering.flatMap(({ agent }) =>
				agent.afterwards ? [agent.afterwards] : []
			),
		];
	}

	private get registering() {
		return this.statuses.flatMap((status) =>
			status.registration === "absent" || status.registration === "added"
				? [status]
				: []
		);
	}

	private get registeredNames(): string[] {
		return this.statuses.flatMap(({ agent, registration }) =>
			registration === "present" ? [agent.name] : []
		);
	}
}
