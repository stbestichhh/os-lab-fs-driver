import { Logger } from 'pino';
import { IFileDescriptor, IDirectoryEntry, IOpenFile, IFileSystem } from './interfaces';
import { FileSystemException } from './fsException';
import { FileDescriptor } from './fileDescriptor';

export class FileSystem implements IFileSystem {
  private readonly BLOCK_SIZE = 512;
  private readonly NUM_BLOCKS = 1000;
  private storage: Buffer[] = Array(this.NUM_BLOCKS).fill(Buffer.alloc(this.BLOCK_SIZE));
  private bitmap: boolean[] = Array(this.NUM_BLOCKS).fill(false);
  private fileDescriptors: IFileDescriptor[] = []
  private rootDirectory: IDirectoryEntry[] = [];
  private openFiles: (IOpenFile | null)[] = [];

  constructor(private readonly logger: Logger) {}

  mkfs(descriptorsAmount: number): void {
    this.fileDescriptors = Array(descriptorsAmount).fill(null);
    this.rootDirectory = [];
    this.bitmap.fill(false);
    this.logger.info(`fs initialized with ${descriptorsAmount} descriptors`);
  }

  stat(fileName: string): void {
    const entry = this.rootDirectory.find((e) => e.fileName === fileName);
    if (!entry) {
      throw new FileSystemException('file not found');
    }

    const descriptor = this.fileDescriptors[entry.descriptorIndex];
    this.logger.info(`id=${descriptor.id}, type=${descriptor.fileType}, nlink=${descriptor.hardLinks}, size=${descriptor.size}, nblock=${descriptor.blockMap.length}`);
  }

  ls(): void {
    this.rootDirectory.forEach((entry) => {
      const descriptor = this.fileDescriptors[entry.descriptorIndex];
      this.logger.info(`${entry.fileName}\t=> ${descriptor.fileType}, ${descriptor.id}`);
    })
  }

  create(fileName: string): void {
    const fdIndex = this.fileDescriptors.findIndex((fd) => fd === null);
    if (fdIndex === -1) {
      throw new FileSystemException('no available file descriptors');
    }

    const id = Math.floor(Math.random() * 1000);
    this.fileDescriptors[fdIndex] = new FileDescriptor({ id, fileType: 'reg', hardLinks: 1, size: 0, blockMap: [] });

    this.rootDirectory.push({ fileName, descriptorIndex: fdIndex });
  }

  open(fileName: string): number {
    const entry = this.rootDirectory.find((e) => e.fileName === fileName);
    if (!entry) {
      throw new FileSystemException(`${fileName} not found`);
    }

    const fdIndex = entry.descriptorIndex;
    const openFdIndex = this.openFiles.findIndex((file) => file === null);
    const openFd = openFdIndex === -1 ? this.openFiles.length : openFdIndex;

    this.openFiles[openFd] = {
      descriptorIndex: fdIndex,
      position: 0,
    }

    this.logger.info(`fd = ${fdIndex}`);
    return openFd;
  }

  close(fd: number): void {
    if (!this.openFiles[fd]) {
      throw new FileSystemException('invalid descriptor');
    }

    this.openFiles[fd] = null;
    this.logger.info(`closed ${fd} descriptor`);
  }

  seek(fd: number, offset: number): void {
    if (!this.openFiles[fd]) {
      throw new FileSystemException('invalid descriptor');
    }

    this.openFiles[fd].position = offset;
  }

  read(fd: number, size: number): Buffer {
    const file = this.openFiles[fd];
    if (!file) {
      throw new FileSystemException('invalid descriptor');
    }

    const descriptor = this.fileDescriptors[file.descriptorIndex];
    let data = Buffer.alloc(0);

    for (let i = 0; i < size && file.position < descriptor.size; i++) {
      const blockIndex = Math.floor(file.position / this.BLOCK_SIZE);
      const blockOffset = file.position % this.BLOCK_SIZE;

      const block = this.storage[descriptor.blockMap[blockIndex]];
      data = Buffer.concat([data, block.slice(blockOffset)]);
      file.position += this.BLOCK_SIZE - blockOffset;
    }

    const readResult = data.slice(0, size);
    this.logger.info(readResult.toString());
    return readResult;
  }

  write(fd: number, data: Buffer): void {
    const file = this.openFiles[fd];
    if (!file) {
      throw new FileSystemException('invalid descriptor');
    }

    const descriptor = this.fileDescriptors[file.descriptorIndex];
    const remainingData = data;

    while(remainingData.length > 0) {
      const blockIndex = Math.floor(file.position / this.BLOCK_SIZE);
      if (descriptor.blockMap[blockIndex] === undefined) {
        const freeBlockIndex = this.bitmap.indexOf(false);
        if (freeBlockIndex === -1) {
          throw new FileSystemException('no free blocks');
        }
        descriptor.blockMap[blockIndex] = freeBlockIndex;
        this.bitmap[freeBlockIndex] = true;
      }

      const block = this.storage[descriptor.blockMap[blockIndex]];
      const blockOffset = file.position % this.BLOCK_SIZE;
      const bytesToWrite = Math.min(remainingData.length, this.BLOCK_SIZE - blockOffset);

      remainingData.copy(block, blockOffset, 0, bytesToWrite);
      file.position += bytesToWrite;
      remainingData.slice(bytesToWrite);
    }

    descriptor.size = Math.max(descriptor.size, file.position);
  }

  link(oldName: string, newName: string): void {
    const entry = this.rootDirectory.find((e) => e.fileName === oldName);
    if (!entry) {
      throw new FileSystemException(`${oldName}  not found`);
    }

    this.rootDirectory.push({
      fileName: newName, descriptorIndex: entry.descriptorIndex,
    });
    this.fileDescriptors[entry.descriptorIndex].hardLinks++;
  }

  unlink(fileName: string): void {
    const entryIndex = this.rootDirectory.findIndex(e => e.fileName === fileName);
    if (entryIndex === -1) {
      throw new Error('File not found');
    }

    const descriptorIndex = this.rootDirectory[entryIndex].descriptorIndex;
    this.fileDescriptors[descriptorIndex].hardLinks--;

    if (this.fileDescriptors[descriptorIndex].hardLinks === 0) {
      for (const blockIndex of this.fileDescriptors[descriptorIndex].blockMap) {
        this.bitmap[blockIndex] = false;
      }
      this.fileDescriptors.splice(descriptorIndex, 1);
    }

    this.rootDirectory.splice(entryIndex, 1);
  }

  truncate(fileName: string, size: number): void {
    const entry = this.rootDirectory.find((e) => e.fileName === fileName);
    if (!entry) {
      throw new FileSystemException(`${oldName}  not found`);
    }

    const descriptor = this.fileDescriptors[entry.descriptorIndex];
    descriptor.size = size;
  }
}
