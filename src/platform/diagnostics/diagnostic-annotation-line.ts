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

/** A GitHub Actions workflow command that shows `diagnostic` on the pull request. */
export function diagnosticAnnotationLine(
	diagnostic: Diagnostic,
	workspace: string
): string {
	const { severity, code, resource, position, message } = diagnostic;
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
