/**
 * Color palette for multiple choice market outcomes.
 * 10 distinct oklch-based colors, indexed by sort_order.
 * Binary markets continue using green/red.
 */
export const OUTCOME_COLORS = [
  { bg: 'bg-blue-950/30', text: 'text-blue-400', border: 'border-blue-800/40', bgHover: 'hover:bg-blue-950/40', hex: '#60a5fa' },
  { bg: 'bg-purple-950/30', text: 'text-purple-400', border: 'border-purple-800/40', bgHover: 'hover:bg-purple-950/40', hex: '#c084fc' },
  { bg: 'bg-orange-950/30', text: 'text-orange-400', border: 'border-orange-800/40', bgHover: 'hover:bg-orange-950/40', hex: '#fb923c' },
  { bg: 'bg-teal-950/30', text: 'text-teal-400', border: 'border-teal-800/40', bgHover: 'hover:bg-teal-950/40', hex: '#2dd4bf' },
  { bg: 'bg-pink-950/30', text: 'text-pink-400', border: 'border-pink-800/40', bgHover: 'hover:bg-pink-950/40', hex: '#f472b6' },
  { bg: 'bg-yellow-950/30', text: 'text-yellow-400', border: 'border-yellow-800/40', bgHover: 'hover:bg-yellow-950/40', hex: '#facc15' },
  { bg: 'bg-cyan-950/30', text: 'text-cyan-400', border: 'border-cyan-800/40', bgHover: 'hover:bg-cyan-950/40', hex: '#22d3ee' },
  { bg: 'bg-rose-950/30', text: 'text-rose-400', border: 'border-rose-800/40', bgHover: 'hover:bg-rose-950/40', hex: '#fb7185' },
  { bg: 'bg-lime-950/30', text: 'text-lime-400', border: 'border-lime-800/40', bgHover: 'hover:bg-lime-950/40', hex: '#a3e635' },
  { bg: 'bg-indigo-950/30', text: 'text-indigo-400', border: 'border-indigo-800/40', bgHover: 'hover:bg-indigo-950/40', hex: '#818cf8' },
] as const;

export function getOutcomeColor(sortOrder: number) {
  return OUTCOME_COLORS[sortOrder % OUTCOME_COLORS.length];
}
