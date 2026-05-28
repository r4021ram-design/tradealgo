import { Instrument, Segment } from './types';

/**
 * Generates a unique position key for an instrument.
 *
 * EQ:  RELIANCE_EQ
 * FUT: NIFTY_FUT_27JUN2026
 * OPT: NIFTY_OPT_27JUN2026_24500_CE
 */
export function generatePositionKey(inst: Instrument): string {
  const parts: string[] = [inst.symbol, inst.segment];

  if (inst.segment === Segment.FUT || inst.segment === Segment.OPT) {
    parts.push(inst.expiry ?? 'NOEXP');
  }

  if (inst.segment === Segment.OPT) {
    parts.push(String(inst.strikePrice ?? 0));
    parts.push(inst.optionType ?? 'CE');
  }

  return parts.join('_');
}

/**
 * Parses a position key back into a partial Instrument.
 */
export function parsePositionKey(key: string): Instrument {
  const parts = key.split('_');
  const symbol = parts[0];
  const segment = parts[1] as Segment;

  const inst: Instrument = { symbol, segment };

  if (segment === Segment.FUT || segment === Segment.OPT) {
    inst.expiry = parts[2];
  }

  if (segment === Segment.OPT) {
    inst.strikePrice = Number(parts[3]);
    inst.optionType = parts[4] as 'CE' | 'PE';
  }

  return inst;
}

/**
 * Returns a human-readable display name for an instrument.
 *
 * EQ:  "RELIANCE EQ"
 * FUT: "NIFTY FUT JUN 2026"
 * OPT: "NIFTY 24500 CE JUN 2026"
 */
export function displayName(inst: Instrument): string {
  if (inst.segment === Segment.EQ) {
    return `${inst.symbol} EQ`;
  }
  if (inst.segment === Segment.FUT) {
    return `${inst.symbol} FUT ${inst.expiry ?? ''}`.trim();
  }
  // OPT
  return `${inst.symbol} ${inst.strikePrice ?? ''} ${inst.optionType ?? ''} ${inst.expiry ?? ''}`.trim();
}
