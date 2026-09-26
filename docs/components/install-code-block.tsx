import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";

export default async function LatestVersionConfig() {
	let version = "1.4.0";

	try {
		const res = await fetch(
			"https://api.github.com/repos/LDGerrits/rogen/releases/latest",
			{
				next: { revalidate: 3600 },
			}
		);

		if (res.ok) {
			const data = await res.json();
			if (data.tag_name) {
				version = data.tag_name.replace(/^v/, "");
			}
		}
	} catch (err) {
		console.error("Failed to fetch latest Rogen version", err);
	}

	const code = `[tools]\nrogen = "ldgerrits/rogen@${version}"`;

	return (
		<CodeBlock title="rokit.toml">
			<Pre>{code}</Pre>
		</CodeBlock>
	);
}
