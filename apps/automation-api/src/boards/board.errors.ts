export class BoardNotFoundError extends Error {
  constructor(id: string) {
    super(`Board not found: ${id}`);
    this.name = 'BoardNotFoundError';
  }
}

export class BoardGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardGraphError';
  }
}
