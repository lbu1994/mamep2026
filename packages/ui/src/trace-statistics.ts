import type { DataType } from "@mamep2026/domain";
import { decodeFloatWords, isFloatType, interpretRawValueAsNumber } from "@mamep2026/data-conversion";

export interface TraceNumericSample {
  no: number;
  rawValue: number;
  rawValues?: readonly number[] | undefined;
  dataType: DataType;
}

export interface TraceAverage {
  value: number;
  sampleCount: number;
  firstNo: number;
  lastNo: number;
}

/** 对当前缓冲区内仍有明确数值语义的样本计算平均值。 */
export function computeTraceAverage(
  samples: readonly TraceNumericSample[],
): TraceAverage | null {
  let sum = 0;
  let sampleCount = 0;
  let firstNo: number | null = null;
  let lastNo: number | null = null;

  for (const sample of samples) {
    const value = traceNumericValue(sample);
    if (value === null) continue;
    sum += value;
    sampleCount += 1;
    firstNo ??= sample.no;
    lastNo = sample.no;
  }

  if (sampleCount === 0 || firstNo === null || lastNo === null) return null;
  return {
    value: sum / sampleCount,
    sampleCount,
    firstNo,
    lastNo,
  };
}

/** Decode floating-point samples from their original words, never a combined Number. */
export function traceNumericValue(sample: TraceNumericSample): number | null {
  if (isFloatType(sample.dataType)) {
    const decoded = decodeFloatWords(sample.rawValues ?? [], sample.dataType);
    return decoded.ok ? decoded.value : null;
  }
  return interpretRawValueAsNumber(sample.rawValue, sample.dataType);
}
