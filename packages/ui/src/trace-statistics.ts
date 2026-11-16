import type { DataType } from "@mamep2026/domain";
import { interpretRawValueAsNumber } from "@mamep2026/data-conversion";

export interface TraceNumericSample {
  no: number;
  rawValue: number;
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
    const value = interpretRawValueAsNumber(sample.rawValue, sample.dataType);
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
