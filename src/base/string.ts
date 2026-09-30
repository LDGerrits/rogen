export function capitalized(text: string): string {
	return text[0].toUpperCase() + text.slice(1);
}

/** The first `limit` of `items` joined by commas, then an ellipsis when there are more. */
export function listLimited(items: readonly string[], limit: number): string {
	const listed = items.slice(0, limit).join(", ");
	return items.length > limit ? `${listed}, …` : listed;
}
