import { Disposable } from "../../base/disposable.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { PlannedMove, ProjectMigration } from "./project-migration.js";

export interface NextSteps {
	readonly directory?: string;
	readonly setup: readonly string[];
	readonly run: readonly string[];
	readonly edits: readonly string[];
}

export type InitKind = "place" | "model" | "plugin";

export interface InitChoices {
	readonly kind?: InitKind;
	readonly skipGit?: true;
	readonly agentRules?: boolean;
	readonly agentHook?: true;
	readonly language?: string;
	readonly sample?: false;
	readonly places?: boolean;
}

export interface InitDecision {
	readonly question: keyof InitChoices;
	readonly value: string | boolean;
	readonly flag: string;
}

export function booleanFlag(flag: string, value: boolean): string {
	return value ? flag : flag.replace(/^--/, "--no-");
}

export interface PlannedCommand {
	readonly command: string;
	readonly file: string;
	readonly args: readonly string[];
	readonly timeout: number;
}

export interface PlannedScaffold {
	readonly command: PlannedCommand;
	readonly replaces: readonly string[];
}

export interface SummaryRow {
	readonly area: string;
	readonly text: string;
}

export type InitAction = "create" | "lift" | "migrate" | "agents";

export interface InitPlan {
	readonly directory: string;
	readonly action: InitAction;
	readonly summary: readonly SummaryRow[];
	readonly scaffold?: PlannedScaffold;
	readonly moves: readonly PlannedMove[];
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly commands: readonly PlannedCommand[];
	readonly configs: readonly string[];
	readonly notes: readonly string[];
	readonly warnings: readonly Diagnostic[];
	readonly liftedFrom?: string;
	readonly nextSteps: NextSteps;
	readonly asked: boolean;
	readonly decided: readonly InitDecision[];
	readonly gitInit: boolean;
}

export type InitWritten =
	| { readonly kind: "scaffold"; readonly scaffold: PlannedScaffold }
	| { readonly kind: "move"; readonly move: PlannedMove }
	| { readonly kind: "file"; readonly file: PlannedFile }
	| { readonly kind: "directory"; readonly directory: string }
	| { readonly kind: "git"; readonly failed?: string }
	| {
			readonly kind: "command";
			readonly command: PlannedCommand;
			readonly failed?: string;
			readonly skipped?: readonly PlannedCommand[];
	  };

export interface InitOptions {
	readonly ask?: boolean;
	readonly place?: string;
	readonly choices?: InitChoices;
}

export interface InitService {
	readonly _serviceBrand: undefined;

	plan(options?: InitOptions): Promise<Result<InitPlan | undefined, Error>>;

	check(plan: InitPlan): Promise<Result<readonly Diagnostic[], Error>>;

	write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void,
		dryRun?: boolean
	): Promise<Result<void, Error>>;

	registerMigration(migration: ProjectMigration): Disposable;

	refreshAgentRules(folder: string): Promise<string[]>;
}

export const InitService = createDecorator<InitService>("initService");
