import path from "path";
import { toNative } from "../../base/path.js";
import {
	Diagnostic,
	messageRelativeTo,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { CompiledChange, SyncbackPlan } from "./syncback.js";

function unplacedDiagnostics(plan: SyncbackPlan, cwd: string): Diagnostic[] {
	return plan.unplaced.map(({ instance, reason }) =>
		warningDiagnostic(
			"syncback.unplaced",
			{ resource: plan.project.file },
			`${instance} was left out: ${messageRelativeTo(reason, cwd)}.`
		)
	);
}

function compiledDiagnostics(plan: SyncbackPlan): Diagnostic[] {
	const { compiledPath, projectDir, file } = plan.project;
	if (compiledPath === undefined) return [];
	const folder = toNative(path.relative(projectDir, compiledPath));
	const messages: Record<
		CompiledChange["kind"],
		(instance: string) => string
	> = {
		changed: (instance) =>
			`${instance} changed in the place, but it is compiled into ${folder}, so syncback left it out. Make the change in the source files.`,
		removed: (instance) =>
			`${instance} was removed from the place, but it is compiled into ${folder}, so syncback left it out. Remove it from the source files.`,
		added: (instance) =>
			`${instance} is new in the place, but the project compiles into ${folder}, so syncback left it out. Add it to the source files.`,
	};
	return plan.compiled.map(({ instance, kind }) =>
		warningDiagnostic(
			"syncback.compiledPath",
			{ resource: file },
			messages[kind](instance)
		)
	);
}

export function leftOutDiagnostics(plan: SyncbackPlan, cwd: string) {
	return {
		unplaced: unplacedDiagnostics(plan, cwd),
		compiled: compiledDiagnostics(plan),
	};
}
