import Link from "next/link";
import { Logo } from "@/components/logo";
import { socials } from "@/lib/shared";
import { delay } from "./more-link";

const resources = [
	{ text: "Docs", url: "/docs/v2" },
	{ text: "Quick Start", url: "/docs/v2/new-game" },
	{ text: "Architectures", url: "/docs/v2/architectures" },
];

const links = [
	{ text: "GitHub", url: socials.github },
	{ text: "Discord", url: socials.discord },
	{ text: "DevForum", url: socials.devforum },
];

export function Footer() {
	return (
		<footer>
			<div className="wrap cols">
				<div className="fb rv">
					<span className="brand" role="img" aria-label="Rogen">
						<Logo />
						<span aria-hidden="true">Rogen</span>
					</span>
					<p>{new Date().getFullYear()} L.D. Gerrits</p>
				</div>
				<div className="fc rv" style={delay(80)}>
					<h4>Resources</h4>
					<ul>
						{resources.map((link) => (
							<li key={link.text}>
								<Link href={link.url}>{link.text}</Link>
							</li>
						))}
					</ul>
				</div>
				<div className="fc rv" style={delay(160)}>
					<h4>Links</h4>
					<ul>
						{links.map((link) => (
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
				</div>
			</div>
		</footer>
	);
}
