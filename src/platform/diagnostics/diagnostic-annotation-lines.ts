import path from "path";
import { isInside, toPosix } from "../../base/path.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	messageRelativeTo,
} from "./diagnostic.js";

const escapeData = (text: string): string =>
	text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

const escapeProperty = (text: string): string =>
	escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

interface Annotation {
	readonly severity: DiagnosticSeverity;
	readonly code: string;
	readonly resource: string;
	readonly position?: Diagnostic["position"];
	readonly message: string;
}

function lineOf(annotation: Annotation, workspace: string): string {
	const { severity, code, resource, position, message } = annotation;
	const file = isInside(resource, workspace)
		? toPosix(path.relative(workspace, resource))
		: undefined;
	const properties = [
		file === undefined ? undefined : `file=${escapeProperty(file)}`,
		file !== undefined && position ? `line=${position.line}` : undefined,
		file !== undefined && position ? `col=${position.column}` : undefined,
		`title=${escapeProperty(code)}`,
	].filter((property) => property !== undefined);
	const command = severity === DiagnosticSeverity.Error ? "error" : "warning";
	return `::${command} ${properties.join(",")}::${escapeData(messageRelativeTo(message, workspace))}`;
}

/** GitHub Actions workflow commands that show `diagnostic` on the pull request, one per file when it is about several. */
export function diagnosticAnnotationLines(
	diagnostic: Diagnostic,
	workspace: string
): string[] {
	const { severity, code, related } = diagnostic;
	const annotations: Annotation[] = related?.length
		? related.map(({ resource, message }) => ({
				severity,
				code,
				resource,
				message,
			}))
		: [diagnostic];
	return annotations.map((annotation) => lineOf(annotation, workspace));
}
