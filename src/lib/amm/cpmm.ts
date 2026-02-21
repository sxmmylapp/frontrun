/**
 * Constant Product Market Maker (CPMM) for binary prediction markets.
 *
 * Formula: yesPool * noPool = k (constant product invariant)
 *
 * All arithmetic uses decimal.js to prevent floating-point drift.
 * This module is pure math — no database or network calls.
 */
import Decimal from 'decimal.js';

// Configure decimal.js for high precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type PoolState = {
  yesPool: Decimal;
  noPool: Decimal;
};

export type TradeResult = {
  sharesReceived: Decimal;
  newYesPool: Decimal;
  newNoPool: Decimal;
  newYesProbability: Decimal;
  newNoProbability: Decimal;
};

/**
 * Get the current probability of YES outcome.
 * Formula: P(YES) = noPool / (yesPool + noPool)
 *
 * Intuition: When more people buy YES shares, yesPool decreases
 * and noPool increases, pushing the YES price up.
 */
export function yesProbability(pool: PoolState): Decimal {
  const total = pool.yesPool.add(pool.noPool);
  if (total.isZero()) return new Decimal('0.5');
  return pool.noPool.div(total);
}

/**
 * Get the current probability of NO outcome.
 * Formula: P(NO) = yesPool / (yesPool + noPool)
 */
export function noProbability(pool: PoolState): Decimal {
  const total = pool.yesPool.add(pool.noPool);
  if (total.isZero()) return new Decimal('0.5');
  return pool.yesPool.div(total);
}

/**
 * Buy YES shares with a given token amount.
 *
 * Mechanism: tokens are added to the NO pool, then the constant product
 * invariant determines how many YES shares come out of the YES pool.
 *
 * k = yesPool * noPool (before trade)
 * newNoPool = noPool + tokenAmount
 * newYesPool = k / newNoPool
 * sharesReceived = yesPool - newYesPool
 */
export function buyYesShares(
  pool: PoolState,
  tokenAmount: Decimal
): TradeResult {
  validateTradeInputs(pool, tokenAmount);

  const k = pool.yesPool.mul(pool.noPool);
  const newNoPool = pool.noPool.add(tokenAmount);
  const newYesPool = k.div(newNoPool);
  const sharesReceived = pool.yesPool.sub(newYesPool);

  const newPool = { yesPool: newYesPool, noPool: newNoPool };

  return {
    sharesReceived,
    newYesPool,
    newNoPool,
    newYesProbability: yesProbability(newPool),
    newNoProbability: noProbability(newPool),
  };
}

/**
 * Buy NO shares with a given token amount.
 *
 * Mechanism: tokens are added to the YES pool, then the constant product
 * invariant determines how many NO shares come out of the NO pool.
 */
export function buyNoShares(
  pool: PoolState,
  tokenAmount: Decimal
): TradeResult {
  validateTradeInputs(pool, tokenAmount);

  const k = pool.yesPool.mul(pool.noPool);
  const newYesPool = pool.yesPool.add(tokenAmount);
  const newNoPool = k.div(newYesPool);
  const sharesReceived = pool.noPool.sub(newNoPool);

  const newPool = { yesPool: newYesPool, noPool: newNoPool };

  return {
    sharesReceived,
    newYesPool,
    newNoPool,
    newYesProbability: yesProbability(newPool),
    newNoProbability: noProbability(newPool),
  };
}

/**
 * Calculate the projected payout for a hypothetical bet.
 * Returns shares that would be received without modifying any state.
 */
export function previewTrade(
  pool: PoolState,
  outcome: 'yes' | 'no',
  tokenAmount: Decimal
): { sharesReceived: Decimal; impliedProbability: Decimal } {
  const result =
    outcome === 'yes'
      ? buyYesShares(pool, tokenAmount)
      : buyNoShares(pool, tokenAmount);

  return {
    sharesReceived: result.sharesReceived,
    impliedProbability:
      outcome === 'yes' ? result.newYesProbability : result.newNoProbability,
  };
}

/**
 * Create a new market with initial liquidity.
 * A 50/50 market starts with equal pools.
 *
 * @param liquidity - Total initial tokens to seed the market
 * @returns Initial pool state with equal YES/NO pools
 */
export function createMarketPool(liquidity: Decimal): PoolState {
  if (liquidity.lte(0)) {
    throw new Error('Liquidity must be positive');
  }
  const half = liquidity.div(2);
  return { yesPool: half, noPool: half };
}

/**
 * Calculate payout per share after market resolution.
 * Winners split the total pool proportionally to their shares.
 *
 * @param totalPool - Sum of yesPool + noPool at resolution
 * @param winningShares - Total shares held by all winners
 * @returns Tokens per share for winners
 */
export function payoutPerShare(
  totalPool: Decimal,
  winningShares: Decimal
): Decimal {
  if (winningShares.isZero()) return new Decimal(0);
  return totalPool.div(winningShares);
}

/**
 * Validate trade inputs. Throws on invalid state.
 */
function validateTradeInputs(pool: PoolState, tokenAmount: Decimal): void {
  if (tokenAmount.lte(0)) {
    throw new Error('Token amount must be positive');
  }
  if (pool.yesPool.lte(0) || pool.noPool.lte(0)) {
    throw new Error('Pool values must be positive');
  }
}
