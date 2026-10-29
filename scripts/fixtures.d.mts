export interface BenchmarkFixture {
  id: string;
  mode: string;
  kind?: string;
  depth?: number;
  text: string;
}
export function benchmarkFixtures(): BenchmarkFixture[];
export function writeFixtures(directory: string): Array<Omit<BenchmarkFixture, 'text'> & {
  filename: string;
  bytes: number;
  utf16: number;
  lines: number;
  sha256: string;
}>;
