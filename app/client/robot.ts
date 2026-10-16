// Pixel-art robot girl seen from the side, facing right.
// Each frame is a 20x23 grid; one character per pixel ("." = transparent).

const PALETTE: Record<string, string> = {
  k: "#1b1e24", // outline
  w: "#e9eef3", // head
  v: "#4D9ABF", // visor (Pi blue)
  e: "#fff4c2", // eye
  p: "#F09082", // bow, cheek, skirt (Pi pink)
  y: "#F1BE58", // body, antenna (Pi yellow)
  g: "#c3cad2", // near limbs
  d: "#7d8691", // far limbs
};

const BODY = [
  "...........y........",
  "...........k........",
  "..pp.pp....k........",
  "..ppppp.kkkkkkk.....",
  "...pppkkwwwwwwwkk...",
  ".....kwwwwwwvvvvvk..",
  ".....kwwwwwwvveevk..",
  ".....kwwwwwwvveevk..",
  ".....kwwwwwwvvvvvk..",
  ".....kwwwwwwwwwpwk..",
  "......kkwwwwwwwwkk..",
  "........kkkkkkkk....",
  "..........kk........",
  "........kyyyyk......",
  ".......kyyyyyyk.....",
  ".......kyyyyyyk.....",
  ".......kyyyyyyk.....",
  "......kppppppppk....",
  ".....kppppppppppk...",
  "......kkkkkkkkkk....",
];

const LEGS = {
  strideA: ["........dd..gg......", ".......dd....gg.....", "......dd......gg....", ".....kkk.......kkk.."],
  strideB: ["........gg..dd......", ".......gg....dd.....", "......gg......dd....", ".....kkk.......kkk.."],
  passing: ["..........gg........", "..........gg........", "..........gg........", "..........kkk......."],
  runA: ["........dd..gg......", "......dd.....gg.....", "....dd........gg....", "...kk..........kkk.."],
  runB: ["........gg..dd......", "......gg.....dd.....", "....gg........dd....", "...kk..........kkk.."],
  tuck: ["........ggdd........", ".......gg..dd.......", "......kk....kk......", "...................."],
};

type Arm = "back" | "mid" | "front";
const ARMS: Record<Arm, [number, number][]> = {
  back: [[14, 9], [14, 8], [15, 7], [15, 6], [16, 5], [16, 4]],
  mid: [[14, 10], [14, 11], [15, 10], [15, 11], [16, 10], [16, 11]],
  front: [[14, 11], [14, 12], [15, 13], [15, 14], [16, 15], [16, 16]],
};

const COLS = 20;
const ROWS = 25; // 24 rows of art + 1 row for the walking bob

function grid(legs: string[], arm: Arm, blink = false): string[][] {
  const rows = BODY.concat(legs).map((r) => r.split(""));
  for (const [r, c] of ARMS[arm]) rows[r][c] = "g";
  if (blink) for (const r of [6, 7]) rows[r] = rows[r].map((ch) => (ch === "e" ? "v" : ch));
  return rows;
}

export const SCALE = 5;
export const WIDTH = COLS * SCALE;
export const HEIGHT = ROWS * SCALE;

function svg(rows: string[][], dy: number): string {
  let rects = "";
  rows.forEach((row, y) =>
    row.forEach((ch, x) => {
      if (ch !== ".") rects += '<rect x="' + x + '" y="' + (y + dy) + '" width="1.02" height="1.02" fill="' + PALETTE[ch] + '"/>';
    }),
  );
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + HEIGHT +
    '" viewBox="0 0 ' + COLS + " " + ROWS + '" shape-rendering="crispEdges">' + rects + "</svg>"
  );
}

// Walk cycle: stride frames sit one pixel lower than passing frames (body bob).
export const WALK = [
  svg(grid(LEGS.strideA, "back"), 1),
  svg(grid(LEGS.passing, "mid"), 0),
  svg(grid(LEGS.strideB, "front"), 1),
  svg(grid(LEGS.passing, "mid"), 0),
];
// Run cycle: long strides alternate with an airborne, legs-tucked frame.
export const RUN = [
  svg(grid(LEGS.runA, "back"), 1),
  svg(grid(LEGS.tuck, "front"), 0),
  svg(grid(LEGS.runB, "front"), 1),
  svg(grid(LEGS.tuck, "back"), 0),
];
export const IDLE = svg(grid(LEGS.passing, "mid"), 1);
export const BLINK = svg(grid(LEGS.passing, "mid", true), 1);
