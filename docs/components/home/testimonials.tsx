import { delay } from "./more-link";

const quotes = [
	{
		quote: "It has been a game changer for my team and I",
		author: "Acecateer",
		role: "Technical Director, Wonder Works Studio",
		url: "https://wonderworks.gg",
		className: "q1",
	},
	{
		quote: "Spent the last couple days refactoring Lua Learning to use Rogen. I love it",
		author: "Zack (boatbomber) Williams",
		role: "CEO, Torpedo Software",
		url: "https://www.torpedosoftware.llc",
		className: "q2",
	},
];

export function Testimonials() {
	return (
		<section className="sec alt" aria-labelledby="q-h">
			<div className="wrap">
				<h2 id="q-h" className="sr">
					Used by Roblox studios
				</h2>
				<div className="cols q">
					{quotes.map((q, i) => (
						<blockquote
							key={q.author}
							className={`${q.className} rv`}
							style={delay(i * 120)}
						>
							<p>“{q.quote}”</p>
							<cite>
								<a
									href={q.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									{q.author}
								</a>
								<br />
								{q.role}
							</cite>
						</blockquote>
					))}
				</div>
			</div>
		</section>
	);
}
