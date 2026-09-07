/** ANSI colours, disabled when stdout isn't a TTY or NO_COLOR is set. */
const on = process.stdout.isTTY && !process.env.NO_COLOR;
export const c = {
  green: (s: string) => (on ? `\x1b[38;5;46m${s}\x1b[0m` : s),
  dim: (s: string) => (on ? `\x1b[38;5;28m${s}\x1b[0m` : s),
  faint: (s: string) => (on ? `\x1b[38;5;238m${s}\x1b[0m` : s),
  bold: (s: string) => (on ? `\x1b[1m${s}\x1b[0m` : s),
};

/**
 * Boot banner: the same two-hands-reaching motif as the dashboard, in ASCII.
 * Printed once at startup so a terminal session is recognisably the same product.
 */
export function banner(subtitle = "") {
  const art = [
    `      ▄▄▄▄▄▄▄▄▄▄▄▄▖                                     `,
    `   ▄██████████████▙▖▖                        ▗▄▄▄▄▄▄▄▄▄▖`,
    `  ████████████████████▄▖        ▗▄▄▄▄▄▄▄▄▄▄████████████ `,
    `   ▀████████████████████▙▄▄▄▄▄▟████████████████████████ `,
    `     ▀▀████████████▛▀▀        ▝▀▀████████████████████▛▀ `,
    `        ▀▀▀▀▀▀▀▀▀                    ▀▀▀▀▀▀▀▀▀▀▀▀▀▀     `,
  ];
  const lines = [
    "",
    ...art.map((l) => "  " + c.faint(l)),
    "",
    `  ${c.bold(c.green("> perfecting"))}${c.dim("_")}   ${c.faint("Hello World")}`,
    subtitle ? `  ${c.dim(subtitle)}` : "",
    "",
  ];
  console.log(lines.filter((l) => l !== "").join("\n"));
}
