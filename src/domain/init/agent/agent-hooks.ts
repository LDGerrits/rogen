import { PlannedFile } from "../../toolchain/toolchain.js";
import { DOCS_URL } from "../../../platform/product/product-service.js";
import { hookScript } from "./hook-script.js";
import {
	CLAUDE_SETTINGS_FILE,
	HOOK_SCRIPT_FILE,
	CodingAgent,
	withHook,
} from "./coding-agent.js";

export interface AgentInUse {
	readonly agent: CodingAgent;
	readonly text: string | undefined;
}

interface AgentHooksParts {
	readonly scriptExists: boolean;
	readonly inUse: readonly AgentInUse[];
}

export class AgentHooks {
	private readonly registering: readonly {
		readonly target: CodingAgent;
		readonly text: string;
		readonly existed: boolean;
	}[];
	private readonly unreadable: readonly CodingAgent[];

	constructor(private readonly state: AgentHooksParts) {
		const registrations = state.inUse.map(({ agent: target, text }) => ({
			target,
			registration: withHook(text, target.hook),
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

	/** Whether a coding agent whose hook file Rogen knows is in use here, whether or not it has the hook. */
	get inUse(): boolean {
		return this.state.inUse.length > 0;
	}

	/** Whether Claude Code is one of the agents in use here. */
	get usesClaudeCode(): boolean {
		return this.state.inUse.some(
			({ agent }) => agent.settingsFile === CLAUDE_SETTINGS_FILE
		);
	}

	get offered(): boolean {
		return this.registering.length > 0;
	}

	get agents(): string[] {
		return this.registering.map(({ target }) => target.name);
	}

	get files(): PlannedFile[] {
		return [
			...(this.state.scriptExists
				? []
				: [{ fileName: HOOK_SCRIPT_FILE, content: hookScript }]),
			...this.registering.map(({ target, text, existed }) => ({
				fileName: target.settingsFile,
				content: text,
				...(existed && { addition: "the Rogen hook" }),
			})),
		];
	}

	get notes(): string[] {
		return this.unreadable.map(
			({ settingsFile }) =>
				`${settingsFile} isn't plain JSON, so it was left alone. Register ${HOOK_SCRIPT_FILE} in it by hand: ${DOCS_URL}/agents`
		);
	}

	get setup(): string[] {
		return [
			"The hook runs the Rogen in node_modules/.bin, else the one on the PATH; install Rogen in the project or globally.",
			...this.registering.flatMap(({ target }) =>
				target.afterwards ? [target.afterwards] : []
			),
		];
	}
}
