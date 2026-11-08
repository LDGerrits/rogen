import { Result, ok } from "../../base/result.js";
import { joinedWithAnd, joinedWithOr } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import {
	CLAUDE_SETTINGS_FILE,
	CODING_AGENTS,
	GEMINI_SETTINGS_FILE,
	HOOK_SCRIPT_FILE,
} from "./agent/coding-agent.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { Setup } from "./setup.js";

/** The agents that read a file of their own in place of `AGENTS.md`. */
const OWN_FILES = [
	{ fileName: "CLAUDE.md", settingsFile: CLAUDE_SETTINGS_FILE },
	{ fileName: "GEMINI.md", settingsFile: GEMINI_SETTINGS_FILE },
] as const;

interface AgentChoices {
	readonly rules: boolean;
	readonly hook: boolean;
}

export class AgentSetup implements Setup<AgentChoices> {
	constructor(
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks,
		private readonly questions: InitQuestions,
		/** The folder init sets up, which the agents are looked for in. */
		private readonly folder: string
	) {}

	/** Why `--agent-hook` adds nothing in `folder`: no coding agent is in use there. A warning where init writes the rest anyway. */
	static noCodingAgent(
		folder: string,
		severity: DiagnosticSeverity
	): Diagnostic {
		const signs = CODING_AGENTS.flatMap(({ signs }) => signs);
		const message = `--agent-hook adds the hook to the coding agents in use here, and init found none, so it adds no hook. An agent is in use where its folder or file is: ${joinedWithOr(signs)}. Once one is, run 'rogen init --agent-hook'.`;
		return {
			...warningDiagnostic(
				"init.noCodingAgent",
				{ resource: folder },
				message
			),
			severity,
		};
	}

	/** `--agent-hook` was given and no coding agent is in use here. */
	get hookUnfound(): boolean {
		return this.questions.choices.agentHook === true && !this.hooks.inUse;
	}

	async ask(): Promise<Result<AgentChoices | undefined, Diagnostic[]>> {
		const rules = this.agentFile.hasBlock
			? false
			: await this.questions.addAgentInstructions(
					this.agentFile.fileName
				);
		if (rules === undefined) return ok(undefined);
		const hook = this.hooks.offered
			? await this.questions.addAgentHook(this.hooks.agents)
			: false;
		if (hook === undefined) return ok(undefined);
		return ok({ rules, hook });
	}

	plan({ rules, hook }: AgentChoices, builder: InitPlanBuilder): void {
		if (rules)
			builder.addAgentFile(
				this.agentFile,
				this.agentFile.imports(
					OWN_FILES.filter(({ settingsFile }) =>
						this.hooks.uses(settingsFile)
					).map(({ fileName }) => fileName)
				)
			);
		builder.addAgentHook(this.hooks, hook);
		if (
			!hook &&
			this.hooks.offered &&
			!(
				this.questions.customising &&
				this.questions.choices.agentHook === undefined
			)
		) {
			const { agents } = this.hooks;
			const one = agents.length === 1;
			builder.addNote(
				`${joinedWithAnd(agents)} ${one ? "is" : "are"} in use here. 'rogen init --agent-hook' adds a hook that reports Rogen's warnings when ${one ? "it ends its turn" : "they end their turn"}.`
			);
		}
		const { restoring } = this.hooks;
		builder.addSummary(
			"Agents",
			[
				...(rules || this.agentFile.hasBlock
					? [`rules in ${this.agentFile.blockFileName}`]
					: []),
				...(hook
					? [`hook for ${this.hooks.agents.join(", ")}`]
					: this.hooks.offered
						? [`no hook for ${joinedWithAnd(this.hooks.agents)}`]
						: []),
				...(restoring.length > 0
					? [`hook script restored for ${joinedWithAnd(restoring)}`]
					: []),
			].join(", ") || "none"
		);
		if (this.agentFile.hasBlock && this.questions.choices.agentRules)
			builder.addNote(
				`Rogen's rules are in ${this.agentFile.blockFileName} already. A 'rogen write' keeps them current.`
			);
		const { registered } = this.hooks;
		if (this.questions.choices.agentHook && registered.length > 0)
			builder.addNote(
				`The Rogen hook is registered for ${joinedWithAnd(registered)} already.`
			);
		if (restoring.length > 0)
			builder.addNote(
				`The Rogen hook of ${joinedWithAnd(restoring)} runs ${HOOK_SCRIPT_FILE}, which is missing, so init writes it back.`
			);
		for (const note of this.hooks.notes) builder.addNote(note);
		if (this.hookUnfound)
			builder.addWarning(
				AgentSetup.noCodingAgent(
					this.folder,
					DiagnosticSeverity.Warning
				)
			);
	}
}
