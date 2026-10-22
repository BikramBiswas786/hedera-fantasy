// Prize splits for contests, as basis points per rank (sum 10000, never increasing),
// which is the format the contract checks. Shared by the web app and the sync script.

export const PRIZE_PRESETS = {
  winner: { label: "Winner takes all" },
  top2: { label: "Top 2 (70/30)" },
  top3: { label: "Top 3 (50/30/20)" },
  top10pct: { label: "Top 10% win", share: 0.1 },
  top25pct: { label: "Top 25% win", share: 0.25 },
  top50pct: { label: "Top 50% win", share: 0.5 },
};

const MAX_RANKS = 150; // the contract's MAX_PRIZE_RANKS

/** Prize basis points per rank for a preset and contest size. */
export function prizeBps(preset, maxEntries) {
  if (preset === "winner" || maxEntries <= 2) return [10000];
  if (preset === "top2") return [7000, 3000];
  if (preset === "top3") return maxEntries >= 3 ? [5000, 3000, 2000] : [7000, 3000];
  const share = PRIZE_PRESETS[preset]?.share;
  if (!share) throw new Error(`unknown prize preset: ${preset}`);
  const ranks = Math.min(MAX_RANKS, Math.max(1, Math.floor(maxEntries * share)));
  // Higher ranks win more: weight 1/rank^0.8, floored, with the rounding remainder to 1st.
  const weights = Array.from({ length: ranks }, (_, i) => 1 / (i + 1) ** 0.8);
  const total = weights.reduce((a, w) => a + w, 0);
  const bps = weights.map((w) => Math.floor((w / total) * 10000));
  bps[0] += 10000 - bps.reduce((a, b) => a + b, 0);
  return bps;
}
