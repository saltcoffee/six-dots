export type CommitResult = 'applied' | 'rejected' | 'diverged';
export type ExtractionResult = 'success' | 'create-failed' | 'creation-unknown' | 'partial' | 'target-changed' | 'diverged';
export interface ExtractionSteps {
  create(): Promise<void>;
  creationState(): Promise<'absent' | 'unknown'>;
  valid(): boolean;
  verifyTarget(): Promise<boolean>;
  commit(): CommitResult;
}

export async function runExtraction(steps: ExtractionSteps): Promise<ExtractionResult> {
  try { await steps.create(); }
  catch {
    try { return await steps.creationState() === 'absent' ? 'create-failed' : 'creation-unknown'; }
    catch { return 'creation-unknown'; }
  }
  try {
    if (!steps.valid()) return 'partial';
    if (!await steps.verifyTarget()) return 'target-changed';
    if (!steps.valid()) return 'partial';
    // The final validity check and commit deliberately have no asynchronous gap.
    const result = steps.commit();
    return result === 'applied' ? 'success' : result === 'diverged' ? 'diverged' : 'partial';
  } catch { return 'partial'; }
}
