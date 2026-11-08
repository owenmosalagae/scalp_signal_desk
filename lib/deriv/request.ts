// Keep the deadline active through response-body parsing, not just HTTP headers.
export async function withRequestTimeout<T>(work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal, milliseconds = 15_000): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (external?.aborted) cancel();
  else external?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  try { return await work(controller.signal); }
  catch (error) {
    if (timedOut && !external?.aborted) throw new Error('The server request timed out. Retrying automatically.');
    throw error;
  } finally { clearTimeout(timer); external?.removeEventListener('abort', cancel); }
}
