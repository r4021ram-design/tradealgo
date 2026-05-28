import { Side, Fill, DerivedPosition, MarketPrice, PositionSummary } from './types';
import { generatePositionKey } from './instrumentRegistry';

/**
 * Derives the active positions from a list of historical fills.
 * Processes fills in chronological order using FIFO matching logic.
 */
export function computePositionsFromFills(fills: Fill[]): Record<string, DerivedPosition> {
  const sortedFills = [...fills].sort((a, b) => a.timestamp - b.timestamp);
  const positions: Record<string, DerivedPosition> = {};

  for (const fill of sortedFills) {
    const key = generatePositionKey(fill.instrument);

    if (!positions[key]) {
      positions[key] = {
        positionKey: key,
        instrument: fill.instrument,
        netQty: 0,
        avgBuyPrice: 0,
        avgSellPrice: 0,
        totalBuyQty: 0,
        totalSellQty: 0,
        realizedPnl: 0,
        openTrades: [],
        closedTrades: [],
      };
    }

    const pos = positions[key];

    // Update basic totals
    if (fill.side === Side.BUY) {
      const prevTotalCost = pos.avgBuyPrice * pos.totalBuyQty;
      pos.totalBuyQty += fill.qty;
      pos.avgBuyPrice = (prevTotalCost + fill.price * fill.qty) / pos.totalBuyQty;
    } else {
      const prevTotalCost = pos.avgSellPrice * pos.totalSellQty;
      pos.totalSellQty += fill.qty;
      pos.avgSellPrice = (prevTotalCost + fill.price * fill.qty) / pos.totalSellQty;
    }

    let remainingFillQty = fill.qty;

    while (remainingFillQty > 0) {
      if (pos.openTrades.length === 0) {
        // No open trades, create a new open trade entry
        pos.openTrades.push({
          id: `${fill.id}-${fill.qty - remainingFillQty}`,
          instrument: fill.instrument,
          side: fill.side,
          qty: fill.qty, // original quantity
          remainingQty: remainingFillQty,
          avgPrice: fill.price,
          timestamp: fill.timestamp,
        });
        remainingFillQty = 0;
      } else {
        const firstOpenTrade = pos.openTrades[0];

        if (firstOpenTrade.side === fill.side) {
          // Same side, add another open trade (FIFO entry)
          pos.openTrades.push({
            id: `${fill.id}-${fill.qty - remainingFillQty}`,
            instrument: fill.instrument,
            side: fill.side,
            qty: fill.qty,
            remainingQty: remainingFillQty,
            avgPrice: fill.price,
            timestamp: fill.timestamp,
          });
          remainingFillQty = 0;
        } else {
          // Opposite side, perform FIFO matching
          const matchQty = Math.min(firstOpenTrade.remainingQty, remainingFillQty);
          firstOpenTrade.remainingQty -= matchQty;
          remainingFillQty -= matchQty;

          // Calculate Realized PNL for this match
          let pnl = 0;
          if (firstOpenTrade.side === Side.BUY) {
            // Entry was BUY, exit is SELL
            pnl = (fill.price - firstOpenTrade.avgPrice) * matchQty;
          } else {
            // Entry was SELL, exit is BUY
            pnl = (firstOpenTrade.avgPrice - fill.price) * matchQty;
          }

          pos.realizedPnl += pnl;

          pos.closedTrades.push({
            id: `${firstOpenTrade.id}-${fill.id}-${matchQty}`,
            instrument: fill.instrument,
            entrySide: firstOpenTrade.side,
            exitSide: fill.side,
            qty: matchQty,
            entryPrice: firstOpenTrade.avgPrice,
            exitPrice: fill.price,
            pnl: pnl,
            entryTime: firstOpenTrade.timestamp,
            exitTime: fill.timestamp,
          });

          if (firstOpenTrade.remainingQty === 0) {
            pos.openTrades.shift(); // Remove completed open trade
          }
        }
      }
    }

    // Update netQty
    pos.netQty = pos.totalBuyQty - pos.totalSellQty;
  }

  return positions;
}

/**
 * Calculates Position Summaries including Unrealized PNL and MTM based on Market Prices.
 */
export function calculatePositionSummaries(
  derivedPositions: Record<string, DerivedPosition>,
  marketPrices: Record<string, MarketPrice>
): PositionSummary[] {
  return Object.values(derivedPositions).map((pos) => {
    const key = pos.positionKey;
    const ltp = marketPrices[key]?.ltp ?? 0;

    let avgPrice = 0;
    let side: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';

    if (pos.netQty > 0) {
      side = 'LONG';
      // Average price of remaining open trades
      const totalOpenQty = pos.openTrades.reduce((sum, t) => sum + t.remainingQty, 0);
      const totalOpenCost = pos.openTrades.reduce((sum, t) => sum + t.avgPrice * t.remainingQty, 0);
      avgPrice = totalOpenQty > 0 ? totalOpenCost / totalOpenQty : 0;
    } else if (pos.netQty < 0) {
      side = 'SHORT';
      const totalOpenQty = pos.openTrades.reduce((sum, t) => sum + t.remainingQty, 0);
      const totalOpenCost = pos.openTrades.reduce((sum, t) => sum + t.avgPrice * t.remainingQty, 0);
      avgPrice = totalOpenQty > 0 ? totalOpenCost / totalOpenQty : 0;
    }

    // Unrealized PNL formula:
    // LONG: (LTP - Avg Price) * Net Qty
    // SHORT: (Avg Price - LTP) * |Net Qty|
    let unrealizedPnl = 0;
    if (side === 'LONG') {
      unrealizedPnl = (ltp - avgPrice) * pos.netQty;
    } else if (side === 'SHORT') {
      unrealizedPnl = (avgPrice - ltp) * Math.abs(pos.netQty);
    }

    // MTM = Realized PNL + Unrealized PNL
    const mtm = pos.realizedPnl + unrealizedPnl;

    return {
      positionKey: key,
      instrument: pos.instrument,
      netQty: pos.netQty,
      side,
      avgPrice,
      ltp,
      realizedPnl: pos.realizedPnl,
      unrealizedPnl,
      mtm,
    };
  });
}
