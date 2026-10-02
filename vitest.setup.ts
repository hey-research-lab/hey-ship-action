/**
 * No test may touch the network. The action itself makes no network call; any call reaching the
 * real `fetch` is a mistake, so fail loudly instead of silently making a request.
 */
const blocked = async (input: unknown): Promise<never> => {
  const target = typeof input === 'string' ? input : String(input);
  throw new Error(`Network access is disabled in tests. Something tried to fetch ${target}.`);
};

globalThis.fetch = blocked as unknown as typeof fetch;
