import path from "path";
import { toPosix } from "../../base/path.js";
import { UsageError } from "../../base/errors.js";
import { AgentFile } from "./agent/agent-file.js";
import { AgentHooks } from "./agent/agent-hooks.js";
import { AgentSetup } from "./agent-setup.js";
import { PresentItem } from "./init-service.js";
import { InitQuestions } from "./init-questions.js";
import { ProjectChanger } from "./project-changer.js";
import { ToolchainSetup } from "./toolchain-setup.js";
import { AnsweredSetup, Setup } from "./setup.js";

export class InitAdditions {
	constructor(
		private readonly questions: InitQuestions,
		private readonly agentFile: AgentFile,
		private readonly hooks: AgentHooks,
		private readonly tools: ToolchainSetup,
		/** The toolchain file that pins Rojo already, if one does. */
		private readonly pinnedIn: string | undefined,
		/** The folder the files of the additions are named from. */
		private readonly directory: string,
		/** Changes the config of the folder, when it can be read. */
		private readonly changer?: ProjectChanger
	) {}

	/** What the project has of the additions, as `only` asks (all of them when it is not given). */
	present(only?: ReadonlySet<PresentItem["item"]>): PresentItem[] {
		const { agentFile, hooks, pinnedIn, directory } = this;
		const wanted = (item: PresentItem["item"]) => !only || only.has(item);
		return [
			...(agentFile.hasBlock && wanted("agentRules")
				? [
						{
							item: "agentRules" as const,
							file: agentFile.blockFileName,
						},
					]
				: []),
			...(wanted("agentHook")
				? hooks.registeredIn.map((file) => ({
						item: "agentHook" as const,
						file,
					}))
				: []),
			...(pinnedIn && wanted("rojo")
				? [
						{
							item: "rojo" as const,
							file: toPosix(path.relative(directory, pinnedIn)),
						},
					]
				: []),
		];
	}

	/** What the flags ask for that the project has already. */
	presentAsked(): PresentItem[] {
		const { choices } = this.questions;
		return this.present(
			new Set([
				...(choices.agentRules === true ? ["agentRules" as const] : []),
				...(choices.agentHook === true ? ["agentHook" as const] : []),
				...(choices.rojo === true ? ["rojo" as const] : []),
			])
		);
	}

	/** What the flags ask to add, or `undefined` when they ask for nothing. What is already there is not added again. */
	requested(): Setup<unknown>[] | undefined {
		const { questions, agentFile, hooks, tools } = this;
		const { choices } = questions;
		const rules = choices.agentRules === true && !agentFile.hasBlock;
		const hook = choices.agentHook === true && hooks.offered;
		const rojo = choices.rojo === true;
		if (
			choices.agentRules !== true &&
			choices.agentHook !== true &&
			!rojo &&
			choices.plugin !== true
		)
			return undefined;
		return [
			...(rules || hook
				? [
						new AnsweredSetup(
							new AgentSetup(agentFile, hooks, questions),
							{ rules, hook }
						),
					]
				: []),
			...(rojo || choices.plugin === true
				? [rojo ? tools.asked() : tools.pluginOnly()]
				: []),
		];
	}

	/** The tools a change that turns Darklua on needs pinned. */
	toolsForChanges(): Setup<unknown>[] {
		const { darklua, rojo, plugin } = this.questions.choices;
		return darklua === true &&
			!this.changer?.place &&
			rojo !== true &&
			plugin !== true
			? [this.tools]
			: [];
	}

	/** What a run with no flags does: the safe additions it can make without asking in a run that can't ask, else what the user picks from the areas that have something to change. `nothing` when there is none. */
	async choose(): Promise<
		| {
				readonly setups: Setup<unknown>[];
				/** The setups change the config of a place, so the plan is the place's folder. */
				readonly inPlace: boolean;
		  }
		| { readonly place: string }
		| "nothing"
		| undefined
	> {
		const { questions, agentFile, hooks, tools, changer } = this;
		const own = changer?.place === true;
		const agents = new AgentSetup(agentFile, hooks, questions);
		const { choices } = questions;
		const wantsRules = !agentFile.hasBlock && choices.agentRules !== false;
		const wantsHook = hooks.offered && choices.agentHook !== false;
		const wantsTools = choices.rojo !== false;
		const areas = [
			...(changer ? await changer.areas() : []),
			...(wantsRules || wantsHook
				? [
						{
							id: "agents",
							label: "Agents",
							hint: wantsRules
								? "Rogen's rules for coding agents, and the hook"
								: "the hook",
						},
					]
				: []),
			...(wantsTools && (await tools.rojoMissing())
				? [
						{
							id: "tools",
							label: "Tools",
							hint: "pin Rojo, or install Rokit and Rojo, and the Studio plugin",
						},
					]
				: []),
		];
		if (!questions.interactive) {
			const setups: Setup<unknown>[] = [
				...(changer && areas.some(({ id }) => id === "workspace")
					? [changer.setup(async () => ({ workspace: true }))]
					: []),
				...(!wantsRules
					? []
					: [
							new AnsweredSetup(agents, {
								rules: true,
								hook: false,
							}),
						]),
				...(wantsTools && (await tools.canPin()) ? [tools] : []),
			];
			return setups.length > 0 ? { setups, inPlace: false } : "nothing";
		}
		if (areas.length === 0) return "nothing";
		const rows: [string, string][] = [
			...(changer?.describe() ?? []),
			...(own
				? []
				: ([
						[
							"Agents",
							agentFile.hasBlock
								? `rules in ${agentFile.blockFileName}`
								: "no rules",
						],
						[
							"Tools",
							this.pinnedIn
								? `Rojo pinned in ${toPosix(path.relative(this.directory, this.pinnedIn))}`
								: (await tools.rojoMissing())
									? "Rojo not set up"
									: "Rojo installed",
						],
					] as [string, string][])),
		];
		const width = Math.max(...rows.map(([name]) => name.length));
		const picked = await questions.whatToChange(
			rows
				.map(([name, text]) => `${name.padEnd(width)}  ${text}`)
				.join("\n"),
			areas
		);
		if (picked === undefined) return undefined;
		const request =
			changer && picked.some((id) => !["agents", "tools"].includes(id))
				? await changer.ask(picked)
				: {};
		if (request === undefined) return undefined;
		if ("place" in request) return request;
		const changing = Object.keys(request).length > 0 && changer;
		if (
			own &&
			changing &&
			(picked.includes("agents") || picked.includes("tools"))
		)
			throw new UsageError(
				"The changes of a place and the additions of the project root are made from different folders.",
				"Run init in the root for agent rules, the hook and Rojo."
			);
		return {
			inPlace: own && Boolean(changing),
			setups: [
				...(changing ? [changer.setup(async () => request)] : []),
				...(picked.includes("agents") ? [agents] : []),
				...(picked.includes("tools") ||
				("darklua" in request && request.darklua === true && !own)
					? [tools]
					: []),
			],
		};
	}
}
