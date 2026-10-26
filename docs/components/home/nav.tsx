import Link from "next/link";
import { Logo } from "@/components/logo";
import { socials } from "@/lib/shared";
import { ThemeToggle } from "./theme-toggle";

const external = [
	{ text: "GitHub", url: socials.github },
	{ text: "Discord", url: socials.discord },
	{ text: "Twitter", url: socials.twitter },
];

export function Nav() {
	return (
		<header className="nav">
			<div className="wrap">
				<Link className="brand" href="/" aria-label="Rogen home">
					<Logo />
					Rogen
				</Link>
				<div className="nav-r">
					<ul>
						<li>
							<Link href="/docs/v2">Docs</Link>
						</li>
						{external.map((link) => (
							<li key={link.text}>
								<a
									href={link.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									{link.text}
								</a>
							</li>
						))}
					</ul>
					<ThemeToggle />
				</div>
			</div>
		</header>
	);
}
