'use client';

import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';

type PositionRecord = {
  outcome: 'yes' | 'no';
  shares: number;
  cost: number;
  createdAt: string;
};

type Props = {
  positionHistory: PositionRecord[];
  currentPool: { yesPool: number; noPool: number };
  createdAt: string;
};

function calcYesPercent(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  if (total === 0) return 50;
  return Math.round((noPool / total) * 100);
}

export function ProbabilityTrendChart({ positionHistory, currentPool, createdAt }: Props) {
  const data = useMemo(() => {
    let yesPool = 500;
    let noPool = 500;

    const points: { time: number; yesProb: number }[] = [];

    // Starting point at market creation
    points.push({
      time: new Date(createdAt).getTime(),
      yesProb: 50,
    });

    // Replay each bet through the CPMM
    for (const pos of positionHistory) {
      if (pos.outcome === 'yes') {
        // Buying YES: tokens go into NO pool, shares come out of YES pool
        const k = yesPool * noPool;
        const newNoPool = noPool + pos.cost;
        const newYesPool = k / newNoPool;
        yesPool = newYesPool;
        noPool = newNoPool;
      } else {
        // Buying NO: tokens go into YES pool, shares come out of NO pool
        const k = yesPool * noPool;
        const newYesPool = yesPool + pos.cost;
        const newNoPool = k / newYesPool;
        yesPool = newYesPool;
        noPool = newNoPool;
      }

      points.push({
        time: new Date(pos.createdAt).getTime(),
        yesProb: calcYesPercent(yesPool, noPool),
      });
    }

    // Final point from live pool state
    const liveProb = calcYesPercent(currentPool.yesPool, currentPool.noPool);
    const lastTime = points[points.length - 1].time;
    const now = Date.now();

    // Only add a live point if it differs from the last replayed point
    if (now > lastTime) {
      points.push({ time: now, yesProb: liveProb });
    }

    return points;
  }, [positionHistory, currentPool, createdAt]);

  const currentProb = data[data.length - 1].yesProb;

  return (
    <div className="mt-4 rounded-sm border border-border bg-card px-3 py-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Probability trend</span>
        <span className="text-xs font-medium text-green-400">{currentProb}% YES</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="probFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.72 0.19 142)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="oklch(0.72 0.19 142)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" hide />
          <YAxis domain={[0, 100]} hide />
          <ReferenceLine y={50} stroke="oklch(0.4 0 0)" strokeDasharray="3 3" />
          <Area
            type="stepAfter"
            dataKey="yesProb"
            stroke="oklch(0.72 0.19 142)"
            strokeWidth={2}
            fill="url(#probFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
