/** No file at this key. Callers decide what it means (404, or a server error for a signed file). */
export class StorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

/** Upload refused: a file already exists at this key, and uploads never overwrite. */
export class StorageAlreadyExistsError extends Error {
  constructor(readonly key: string) {
    super(`Storage object already exists: ${key}`);
    this.name = 'StorageAlreadyExistsError';
  }
}
