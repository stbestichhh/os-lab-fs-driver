import { Logger } from 'pino';
import { IDirectoryEntry, IFileDescriptor, IFileSystem, IOpenFile } from './interfaces';
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
  private currentWorkingDirectory: string = '/';

  constructor(private readonly logger: Logger) {}

  private resolvePath(pathname: string) {
    const parts = pathname.split('/').filter(Boolean);
    let directory = this.rootDirectory;
    let name = parts.pop();

    if (pathname.startsWith('/')) {
      directory = this.rootDirectory;
    } else {
      directory = (this.findDirectory(this.currentWorkingDirectory)?.contents ?? []) as IDirectoryEntry[];
    }

    for (const part of parts) {
      const entry = directory.find(e => e.fileName === part);
      if (!entry || this.fileDescriptors[entry.descriptorIndex]?.fileType !== 'dir') {
        throw new FileSystemException(`Directory ${part} not found`);
      }
      directory = (this.fileDescriptors[entry.descriptorIndex]?.contents ?? []) as IDirectoryEntry[];
    }

    return { parent: directory, name: name ?? '' };
  }

  private findDirectory(path: string) {
    const { parent, name } = this.resolvePath(path);
    const entry = parent.find(e => e.fileName === name);
    if (!entry) return null;
    return this.fileDescriptors[entry.descriptorIndex];
  }

  mkdir(pathname: string) {
    const { parent, name } = this.resolvePath(pathname);
    if (parent.find(e => e.fileName === name)) {
      throw new FileSystemException(`Directory ${name} already exists`);
    }

    const fdIndex = this.fileDescriptors.findIndex(fd => fd === null);
    if (fdIndex === -1) {
      throw new FileSystemException(`No available descriptors found`);
    }

    const descriptor = new FileDescriptor({
      id: Math.floor(Math.random() * 1000),
      fileType: 'dir',
      hardLinks: 2,
      size: 0,
      blockMap: [],
      nblock: 0,
      contents: [],
    });
    this.fileDescriptors[fdIndex] = descriptor;

    parent.push({ fileName: name, descriptorIndex: fdIndex });
    (descriptor.contents as IDirectoryEntry[]).push(
      { fileName: '.', descriptorIndex: fdIndex },
      { fileName: '..', descriptorIndex: parent[0]?.descriptorIndex || 0 },
    );

    this.logger.info(`Directory ${name} created`);
  }

  rmdir(pathname: string) {
    const { parent, name } = this.resolvePath(pathname);
    const entryIndex = parent.findIndex(e => e.fileName === name);

    if (entryIndex === -1) {
      throw new FileSystemException(`Directory not found`);
    }

    const descriptor = this.fileDescriptors[parent[entryIndex].descriptorIndex];
    if (!descriptor || descriptor.fileType !== 'dir') {
      throw new FileSystemException(`Not a directory`);
    }

    if (descriptor.contents && descriptor.contents?.length > 2) {
      throw new FileSystemException(`Directory is not empty`);
    }

    parent.slice(entryIndex, 1);
    // @ts-ignore
    this.fileDescriptors[parent[entryIndex].descriptorIndex] = null;
    this.logger.info(`Directory ${name} removed`);
  }

  cd(pathname: string) {
    const directory = this.findDirectory(pathname);
    if (!directory || directory.fileType !== 'dir') {
      throw new FileSystemException(`Not a directory`);
    }

    this.currentWorkingDirectory = pathname;
    this.logger.info(`Changed directory to ${pathname}`);
  }

  symlink(target: string, linkname: string) {
    const { parent, name } = this.resolvePath(linkname);

    if (parent.find(e => e.fileName === name)) {
      throw new FileSystemException(`Link ${name} already exists`);
    }

    const fdIndex = this.fileDescriptors.findIndex(fd => fd === null);
    if (fdIndex === -1) {
      throw new FileSystemException(`No available descriptors`);
    }

    this.fileDescriptors[fdIndex] = new FileDescriptor({
      id: Math.floor(Math.random() * 1000),
      fileType: 'sym',
      hardLinks: 1,
      size: target.length,
      blockMap: [],
      nblock: 0,
      contents: target,
    });

    parent.push({ fileName: name, descriptorIndex: fdIndex });
    this.logger.info(`Symbolic link ${name} created pointing to ${target}`);
  }

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
    this.logger.info(`id=${descriptor.id}, type=${descriptor.fileType}, nlink=${descriptor.hardLinks}, size=${descriptor.size}, nblock=${descriptor.nblock}`);
  }

  ls(): void {
    for (const entry of this.rootDirectory) {
      const descriptor = this.fileDescriptors[entry.descriptorIndex];
      if (descriptor === null) continue;
      this.logger.info(`${entry.fileName}\t=> ${descriptor.fileType}, ${descriptor.id}`);
    }
  }

  create(fileName: string): void {
    const fdIndex = this.fileDescriptors.findIndex((fd) => fd === null);
    if (fdIndex === -1) {
      throw new FileSystemException('no available file descriptors');
    }

    const id = Math.floor(Math.random() * 1000);
    this.fileDescriptors[fdIndex] = new FileDescriptor({ id, fileType: 'reg', hardLinks: 1, size: 0, blockMap: [], nblock: 0 });

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
    this.fileDescriptors[fdIndex].isOpen = true;

    this.logger.info(`fd = ${fdIndex}`);
    return openFd;
  }

  close(fd: number): void {
    if (!this.openFiles[fd]) {
      throw new FileSystemException('invalid descriptor');
    }

    const file = this.openFiles[fd];
    const descriptor = this.fileDescriptors[file.descriptorIndex];
    if (descriptor.hardLinks === 0) {
      this.fileDescriptors.splice(file.descriptorIndex, 1);
    }

    this.openFiles[fd] = null;
  }

  seek(fd: number, offset: number): void {
    if (!this.openFiles[fd]) {
      throw new FileSystemException('invalid descriptor');
    }

    this.openFiles[fd].position = offset;
  }

  read(fd: number, size: number) {
    const file = this.openFiles[fd];
    if (!file) {
      throw new FileSystemException('invalid descriptor');
    }

    const descriptor = this.fileDescriptors[file.descriptorIndex];
    let data = Buffer.alloc(0);

    for (let i = 0; i < size && file.position < descriptor.size; i++) {
      const blockIndex = Math.floor(file.position / this.BLOCK_SIZE);
      const blockOffset = file.position % this.BLOCK_SIZE;

      if (descriptor.blockMap[blockIndex] !== undefined) {
        const block = this.storage[descriptor.blockMap[blockIndex]];
        data = Buffer.concat([data, block.subarray(blockOffset)]);
      } else {
        data = Buffer.concat([data, Buffer.alloc(this.BLOCK_SIZE - blockOffset)]);
      }
      file.position += this.BLOCK_SIZE - blockOffset;
    }

    const readResult = data.slice(0, size);
    this.logger.info(readResult.toString());
  }

  write(fd: number, data: Buffer): void {
    const file = this.openFiles[fd];
    if (!file) {
      throw new FileSystemException('invalid descriptor');
    }

    const descriptor = this.fileDescriptors[file.descriptorIndex];
    let remainingData = data;

    while(remainingData.length > 0) {
      const blockIndex = Math.round(file.position / this.BLOCK_SIZE);

      if (!descriptor.blockMap[blockIndex]) {
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
      remainingData = remainingData.slice(bytesToWrite);
    }

    descriptor.size = Math.max(descriptor.size, file.position);
    descriptor.nblock = descriptor.blockMap.filter((block) => block !== undefined).length;
    this.logger.info(data.toString());
  }

  link(oldName: string, newName: string): void {
    const entry = this.rootDirectory.find((e) => e.fileName === oldName);
    if (!entry) {
      throw new FileSystemException(`${oldName} not found`);
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

      if (!this.fileDescriptors[descriptorIndex]?.isOpen) {
        this.fileDescriptors.splice(descriptorIndex, 1);
      }
    }

    this.rootDirectory.splice(entryIndex, 1);
  }

  truncate(fileName: string, size: number): void {
    const entry = this.rootDirectory.find((e) => e.fileName === fileName);
    if (!entry) {
      throw new FileSystemException(`${fileName}  not found`);
    }

    const descriptor = this.fileDescriptors[entry.descriptorIndex];
    descriptor.size = size;
  }
}
