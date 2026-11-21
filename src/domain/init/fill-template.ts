export const PLACEHOLDERS = ["name", "place", "source", "serve"] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

export function placeholdersIn(text: string): string[] {
	return [...text.matchAll(PLACEHOLDER)].map(([, name]) => name);
}

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
