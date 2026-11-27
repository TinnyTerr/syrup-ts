// Decodes a Haskell string literal as produced by `show :: String -> String`.
const NAMES = [
	"NUL",
	"SOH",
	"STX",
	"ETX",
	"EOT",
	"ENQ",
	"ACK",
	"BEL",
	"BS",
	"HT",
	"LF",
	"VT",
	"FF",
	"CR",
	"SO",
	"SI",
	"DLE",
	"DC1",
	"DC2",
	"DC3",
	"DC4",
	"NAK",
	"SYN",
	"ETB",
	"CAN",
	"EM",
	"SUB",
	"ESC",
	"FS",
	"GS",
	"RS",
	"US",
	"SP",
];
const SIMPLE = {
	a: 7,
	b: 8,
	f: 12,
	n: 10,
	r: 13,
	t: 9,
	v: 11,
	'"': 34,
	"'": 39,
	"\\": 92,
};
// longest first so SOH wins over SO
const BY_LEN = NAMES.map((n, i) => [n, i])
	.concat([["DEL", 127]])
	.sort((a, b) => b[0].length - a[0].length);

export function readHsString(lit) {
	if (lit[0] !== '"' || lit[lit.length - 1] !== '"')
		throw new Error("not a string literal");
	const s = lit.slice(1, -1);
	let out = "";
	for (let i = 0; i < s.length; ) {
		const c = s[i++];
		if (c !== "\\") {
			out += c;
			continue;
		}
		const d = s[i];
		if (d === "&") {
			i++;
			continue;
		}
		if (d in SIMPLE) {
			out += String.fromCodePoint(SIMPLE[d]);
			i++;
			continue;
		}
		const m =
			/^\d+/.exec(s.slice(i)) ??
			/^x[0-9a-fA-F]+/.exec(s.slice(i)) ??
			/^o[0-7]+/.exec(s.slice(i));
		if (m) {
			const t = m[0];
			const n =
				t[0] === "x"
					? parseInt(t.slice(1), 16)
					: t[0] === "o"
						? parseInt(t.slice(1), 8)
						: parseInt(t, 10);
			out += String.fromCodePoint(n);
			i += t.length;
			continue;
		}
		if (d === "^") {
			out += String.fromCodePoint(s.charCodeAt(i + 1) - 64);
			i += 2;
			continue;
		}
		const hit = BY_LEN.find(([n]) => s.startsWith(n, i));
		if (hit) {
			out += String.fromCodePoint(hit[1]);
			i += hit[0].length;
			continue;
		}
		throw new Error(`bad escape \\${d}`);
	}
	return out;
}
