/** What `init` fills in a template: the project's name, the first place's folder, the source path of a single place and the command that serves it. */
export const PLACEHOLDERS = ["name", "place", "source", "serve"] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/** The names between `{{` and `}}` in `text`. */
export function placeholdersIn(text: string): string[] {
	return [...text.matchAll(PLACEHOLDER)].map(([, name]) => name);
}

/** `text` with each `{{name}}` replaced; a placeholder `init` doesn't know, or has no value for, is an error. */
export function fillTemplate(
	text: string,
	values: Readonly<Partial<Record<Placeholder, string>>>
): string {
	return text.replace(PLACEHOLDER, (_, name: string) => {
		const value = (PLACEHOLDERS as readonly string[]).includes(name)
			? values[name as Placeholder]
			: undefined;
		if (value === undefined)
			throw new Error(
				`No value for the template placeholder {{${name}}}.`
			);
		return value;
	});
}
