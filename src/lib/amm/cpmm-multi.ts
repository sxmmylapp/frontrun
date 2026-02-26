/**
 * N-way Constant Product Market Maker for multiple choice prediction markets.
 *
 * Generalizes binary CPMM (yesPool * noPool = k) to N outcomes:
 *   product(pool_i for all i) = k
 *
 * All arithmetic uses decimal.js to prevent floating-point drift.
 * This module is pure math — no database or network calls.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MultiPoolState = Map<string, Decimal>; // outcomeId -> pool value

export type MultiTradeResult = {
  sharesReceived: Decimal;
  newPools: Map<string, Decimal>;
  newProbabilities: Map<string, Decimal>;
};

export type MultiSellResult = {
  tokensReceived: Decimal;
  newPools: Map<string, Decimal>;
  newProbabilities: Map<string, Decimal>;
};

/**
 * Compute the constant product invariant k = product(pool_i).
 */
function computeK(pools: MultiPoolState): Decimal {
  let k = new Decimal(1);
  for (const pool of pools.values()) {
    k = k.mul(pool);
  }
  return k;
}

/**
 * Probability of outcome i: P(i) = (1/pool_i) / sum(1/pool_j for all j)
 *
 * Lower pool = higher probability (more shares have been bought).
 */
export function outcomeProbability(pools: MultiPoolState, outcomeId: string): Decimal {
  const pool = pools.get(outcomeId);
  if (!pool) throw new Error(`Unknown outcome: ${outcomeId}`);

  let recipSum = new Decimal(0);
  for (const p of pools.values()) {
    recipSum = recipSum.add(new Decimal(1).div(p));
  }
  return new Decimal(1).div(pool).div(recipSum);
}

/**
 * All probabilities as a map. Guaranteed to sum to 1.
 */
export function allProbabilities(pools: MultiPoolState): Map<string, Decimal> {
  let recipSum = new Decimal(0);
  for (const p of pools.values()) {
    recipSum = recipSum.add(new Decimal(1).div(p));
  }

  const probs = new Map<string, Decimal>();
  for (const [id, p] of pools) {
    probs.set(id, new Decimal(1).div(p).div(recipSum));
  }
  return probs;
}

/**
 * Buy shares of a specific outcome with a given token amount.
 *
 * Mechanism: tokens are split equally among all NON-target pools (each gets
 * amount/(N-1) tokens). Then the target pool shrinks to maintain k.
 *
 * shares_received = old_target_pool - new_target_pool
 */
export function buyShares(
  pools: MultiPoolState,
  outcomeId: string,
  amount: Decimal
): MultiTradeResult {
  validateTradeInputs(pools, outcomeId, amount);

  const k = computeK(pools);
  const n = pools.size;
  const perOther = amount.div(n - 1);

  // Build new pools with non-target pools increased
  const newPools = new Map<string, Decimal>();
  let otherProduct = new Decimal(1);
  for (const [id, pool] of pools) {
    if (id !== outcomeId) {
      const newPool = pool.add(perOther);
      newPools.set(id, newPool);
      otherProduct = otherProduct.mul(newPool);
    }
  }

  // new target = k / product(other new pools)
  const oldTarget = pools.get(outcomeId)!;
  const newTarget = k.div(otherProduct);
  const sharesReceived = oldTarget.sub(newTarget);

  newPools.set(outcomeId, newTarget);

  return {
    sharesReceived,
    newPools,
    newProbabilities: allProbabilities(newPools),
  };
}

/**
 * Sell shares of a specific outcome back into the pool.
 *
 * Mechanism: shares return to the target pool. Then all other pools must
 * scale down to maintain k. Scale factor r = (k / (new_target * old_other_product))^(1/(N-1))
 *
 * tokens_received = sum(old_pool_j - new_pool_j) for non-target j
 */
export function sellShares(
  pools: MultiPoolState,
  outcomeId: string,
  shares: Decimal
): MultiSellResult {
  validateSellInputs(pools, outcomeId, shares);

  const k = computeK(pools);
  const n = pools.size;
  const oldTarget = pools.get(outcomeId)!;
  const newTarget = oldTarget.add(shares);

  // Product of other pools (before change)
  let otherProduct = new Decimal(1);
  for (const [id, pool] of pools) {
    if (id !== outcomeId) {
      otherProduct = otherProduct.mul(pool);
    }
  }

  // We need: newTarget * newOtherProduct = k
  // newOtherProduct = k / newTarget
  const neededOtherProduct = k.div(newTarget);

  // Scale factor: each other pool *= r where r^(N-1) = neededOtherProduct / otherProduct
  const scaleFactor = neededOtherProduct.div(otherProduct).pow(new Decimal(1).div(n - 1));

  const newPools = new Map<string, Decimal>();
  newPools.set(outcomeId, newTarget);

  let tokensReceived = new Decimal(0);
  for (const [id, pool] of pools) {
    if (id !== outcomeId) {
      const newPool = pool.mul(scaleFactor);
      tokensReceived = tokensReceived.add(pool.sub(newPool));
      newPools.set(id, newPool);
    }
  }

  return {
    tokensReceived,
    newPools,
    newProbabilities: allProbabilities(newPools),
  };
}

/**
 * Preview a buy operation without modifying state.
 */
export function previewMultiTrade(
  pools: MultiPoolState,
  outcomeId: string,
  amount: Decimal
): { sharesReceived: Decimal; newProbabilities: Map<string, Decimal> } {
  const result = buyShares(pools, outcomeId, amount);
  return {
    sharesReceived: result.sharesReceived,
    newProbabilities: result.newProbabilities,
  };
}

/**
 * Preview a sell operation without modifying state.
 */
export function previewMultiSell(
  pools: MultiPoolState,
  outcomeId: string,
  shares: Decimal
): { tokensReceived: Decimal; newProbabilities: Map<string, Decimal> } {
  const result = sellShares(pools, outcomeId, shares);
  return {
    tokensReceived: result.tokensReceived,
    newProbabilities: result.newProbabilities,
  };
}

/**
 * Create a new multi-outcome market pool with equal initial liquidity per outcome.
 */
export function createMultiPool(liquidity: Decimal, outcomeIds: string[]): MultiPoolState {
  if (liquidity.lte(0)) {
    throw new Error('Liquidity must be positive');
  }
  if (outcomeIds.length < 2) {
    throw new Error('Need at least 2 outcomes');
  }
  if (outcomeIds.length > 10) {
    throw new Error('Maximum 10 outcomes');
  }

  const perOutcome = liquidity.div(outcomeIds.length);
  const pools = new Map<string, Decimal>();
  for (const id of outcomeIds) {
    pools.set(id, perOutcome);
  }
  return pools;
}

/**
 * Total pool value (sum of all outcome pools).
 */
export function totalPool(pools: MultiPoolState): Decimal {
  let total = new Decimal(0);
  for (const p of pools.values()) {
    total = total.add(p);
  }
  return total;
}

function validateTradeInputs(pools: MultiPoolState, outcomeId: string, amount: Decimal): void {
  if (amount.lte(0)) {
    throw new Error('Token amount must be positive');
  }
  if (!pools.has(outcomeId)) {
    throw new Error(`Unknown outcome: ${outcomeId}`);
  }
  for (const pool of pools.values()) {
    if (pool.lte(0)) {
      throw new Error('Pool values must be positive');
    }
  }
}

function validateSellInputs(pools: MultiPoolState, outcomeId: string, shares: Decimal): void {
  if (shares.lte(0)) {
    throw new Error('Shares must be positive');
  }
  if (!pools.has(outcomeId)) {
    throw new Error(`Unknown outcome: ${outcomeId}`);
  }
  for (const pool of pools.values()) {
    if (pool.lte(0)) {
      throw new Error('Pool values must be positive');
    }
  }
}
