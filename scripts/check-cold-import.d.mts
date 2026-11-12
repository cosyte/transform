/** The most a cold import of the package may take, in milliseconds: the median of the runs. */
export declare const BUDGET_MS: number;

/** Fresh processes per module. */
export declare const RUNS: number;

/** A reading of the built entry and an empty module, each the median of `runs` fresh imports. */
export interface ColdImportReading {
  readonly medianMs: number;
  readonly emptyMedianMs: number;
  readonly runs: number;
}

/** The median of a non-empty list of numbers. */
export declare function median(values: readonly number[]): number;

/** The verdict on a reading: the line to print and whether the median is over the budget. */
export declare function verdict(
  reading: ColdImportReading,
  budgetMs?: number,
): { readonly over: boolean; readonly line: string };

/** Read `target` and an empty module `runs` times each, interleaved. */
export declare function readColdImport(target: string, runs?: number): ColdImportReading;
