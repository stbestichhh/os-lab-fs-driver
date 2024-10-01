import { IOpenFile } from "./IOpenFile";

export interface IFileSystem {
  mkfs(descriptorsAmount: number): void;
  stat(fileName: string): void;
  ls(): void;
  create(fileName: string): void;
  open(fileName: string): number;
  close(fd: number): void;
  seek(fd: number, offset: number): void;
  read(fd: number, size: number): Buffer;
  write(fd: number, data: Buffer): void;
  link(oldName: string, newName: string): void;
  unlink(fileName: string): void;
  truncate(fileName: string, size: number): void;
}
