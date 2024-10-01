export class FileSystemException extends Error {
  constructor(public readonly message: string) {
    super(message);
  }
}
