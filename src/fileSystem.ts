import { IFileDescriptor, IDirectoryEntry, IOpenFile, IFileSystem } from './interfaces';

export class FileSystem implements IFileSystem {
  private readonly BLOCK_SIZE = 512;
  private readonly NUM_BLOCKS = 1000;
  private storage: Buffer[] = Array(this.NUM_BLOCKS).fill(Buffer.alloc(this.BLOCK_SIZE));
  private bitmap: boolean[] = Array(this.NUM_BLOCKS).fill(false);
  private fileDescriptors: IFileDescriptor[] = []
  private rootDirectory: IDirectoryEntry[] = [];
  private openFile: IOpenFile[] = [];

  mkfs(descriptorsAmount: number): void {
    throw new Error('Method not implemented.');
  }
  stat(fileName: string): void {
    throw new Error('Method not implemented.');
  }
  ls(): void {
    throw new Error('Method not implemented.');
  }
  create(fileName: string): void {
    throw new Error('Method not implemented.');
  }
  open(fileName: string): number {
    throw new Error('Method not implemented.');
  }
  close(fd: number): void {
    throw new Error('Method not implemented.');
  }
  seek(fd: number, offset: number): void {
    throw new Error('Method not implemented.');
  }
  read(fd: number, size: number): Buffer {
    throw new Error('Method not implemented.');
  }
  write(fd: number, size: number): void {
    throw new Error('Method not implemented.');
  }
  link(oldName: string, newName: string): void {
    throw new Error('Method not implemented.');
  }
  unlink(fileName: string): void {
    throw new Error('Method not implemented.');
  }
  truncate(fileName: string, size: number): void {
    throw new Error('Method not implemented.');
  }
}
