import { Logger } from 'pino';
import { IDirectoryEntry, IFileDescriptor, IFileSystem, IOpenFile } from './interfaces';
import { FileSystemException } from './fsException';
import { FileDescriptor } from './fileDescriptor';

export class FileSystem implements IFileSystem {
  private nextId = 1;
  private readonly BLOCK_SIZE = 512;
  private readonly NUM_BLOCKS = 1000;
  private storage: Buffer[] = Array(this.NUM_BLOCKS).fill(Buffer.alloc(this.BLOCK_SIZE));
  private bitmap: boolean[] = Array(this.NUM_BLOCKS).fill(false);
  private fileDescriptors: IFileDescriptor[] = []
  private rootDirectory: IDirectoryEntry[] = [];
  private openFiles: (IOpenFile | null)[] = [];
  private currentWorkingDirectory: string = '/';
  private freeBlocks: number[] = Array.from({ length: this.NUM_BLOCKS }, (_, i) => i);

  constructor(private readonly logger: Logger) {}

  private allocateId(): number {
    return this.nextId++;
  }

  private allocateBlock() {
    if (this.freeBlocks.length === 0) {
      throw new FileSystemException(`No free blocks available`);
    }
    return this.freeBlocks.pop()!;
  }

  private freeBlock(blockIndex: number) {
    this.freeBlocks.push(blockIndex);
  }

  private resolvePath(pathname: string) {
    const parts = pathname.split('/').filter(Boolean);
    let directory = this.fileDescriptors[0].contents as IDirectoryEntry[];
    let name = parts.pop();

    if (!directory) {
      throw new FileSystemException(`Root directory is not initialized`);
    }

    // if (pathname.startsWith('/')) {
    //   directory = this.rootDirectory;
    // } else {
    //   directory = (this.findDirectory(this.currentWorkingDirectory)?.contents ?? []) as IDirectoryEntry[];
    // }

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
      id: this.allocateId(),
      fileType: 'dir',
      hardLinks: 2,
      size: 0,
      blockMap: [],
      nblock: 0,
      contents: [],
      openCount: 0
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
    const resolvedPath = this.resolveSymlink(pathname);
    const { parent, name } = this.resolvePath(resolvedPath);
    const entry = parent.find(e => e.fileName === name);
    if (!entry) {
      throw new FileSystemException(`Directory not found`);
    }

    const descriptor = this.fileDescriptors[entry.descriptorIndex];
    if (descriptor.fileType !== 'dir') {
      throw new FileSystemException(`Not a directory`);
    }

    this.currentWorkingDirectory = resolvedPath;
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
      id: this.allocateId(),
      fileType: 'sym',
      hardLinks: 1,
      size: target.length,
      blockMap: [],
      nblock: 0,
      contents: target,
      openCount: 0
    });

    parent.push({ fileName: name, descriptorIndex: fdIndex });
    this.logger.info(`Symbolic link ${name} created pointing to ${target}`);
  }

  private resolveSymlink(pathname: string, followLastComponent = false, maxDepth = 10) {
    let resolvedPath = pathname;
    let depth = 0;

    while (depth < maxDepth) {
      const { parent, name } = this.resolvePath(resolvedPath);
      const entry = parent.find(e => e.fileName === name);
      if (!entry) {
        return resolvedPath;
      }

      const descriptor = this.fileDescriptors[entry.descriptorIndex];
      if (descriptor.fileType !== 'sym' || (!followLastComponent && depth === 0)) {
        return resolvedPath;
      }

      const target = descriptor.contents as string;
      resolvedPath = target.startsWith('/') ? target : parent.find(e => e.fileName === '.')?.fileName + '/' + target;
      depth++;
    }

    throw new FileSystemException(`Too many symbolic link levels`);
  }

  mkfs(descriptorsAmount: number): void {
    this.fileDescriptors = Array(descriptorsAmount).fill(null);
    this.bitmap.fill(false);

    const rootDescriptorIndex = 0;
    this.fileDescriptors[rootDescriptorIndex] = new FileDescriptor({
      id: 1,
      fileType: 'dir',
      hardLinks: 2,
      size: 0,
      blockMap: [],
      nblock: 0,
      openCount: 0,
      contents: [
        {
          fileName: '.', descriptorIndex: rootDescriptorIndex,
        },
        {
          fileName: '..', descriptorIndex: rootDescriptorIndex,
        }
      ],
    });
    this.rootDirectory.push({
      fileName: '.', descriptorIndex: rootDescriptorIndex,
    });
    this.rootDirectory.push({
      fileName: '..', descriptorIndex: rootDescriptorIndex,
    });

    this.currentWorkingDirectory = '/';
    this.logger.info(`fs initialized with ${descriptorsAmount} descriptors`);
  }

  stat(fileName: string): void {
    const resolvedPath = this.resolveSymlink(fileName);
    const { parent, name } = this.resolvePath(resolvedPath);
    const entry = parent.find((e) => e.fileName === name);

    if (!entry) {
      throw new FileSystemException('file not found');
    }

    const descriptor = this.fileDescriptors[entry.descriptorIndex];
    this.logger.info(`id=${descriptor.id}, type=${descriptor.fileType}, nlink=${descriptor.hardLinks}, size=${descriptor.size}, nblock=${descriptor.nblock}`);
  }

  ls(pathname?: string): void {
    const resolvedPath = this.resolveSymlink(pathname || this.currentWorkingDirectory, true);
    const directory = resolvedPath === '/' ? this.resolvePath(resolvedPath).parent : this.findDirectory(resolvedPath)?.contents;
    if (!directory || !Array.isArray(directory)) {
      throw new FileSystemException(`Not a directory`);
    }

    const maxNameLength = Math.max(...directory.map(e => e.fileName.length));

    for (const e of directory) {
      const entry = e as IDirectoryEntry;
      const descriptor = this.fileDescriptors[entry.descriptorIndex];
      if (descriptor === null) continue;
      const padName = entry.fileName.padEnd(maxNameLength, ' ');
      const info = `${padName}\t=> ${descriptor.fileType}, ${descriptor.id}`;
      if (descriptor.fileType === 'sym') {
        this.logger.info(`${info} -> ${descriptor.contents}`);
      } else {
        this.logger.info(info);
      }
    }
  }

  create(fileName: string): void {
    const { parent, name } = this.resolvePath(fileName);

    if (parent.find(e => e.fileName === name)) {
      throw new FileSystemException(`File ${name} already exists`);
    }

    const fdIndex = this.fileDescriptors.findIndex((fd) => fd === null);
    if (fdIndex === -1) {
      throw new FileSystemException('no available file descriptors');
    }

    const id = this.allocateId();
    this.fileDescriptors[fdIndex] = new FileDescriptor({ id, fileType: 'reg', hardLinks: 1, size: 0, blockMap: [], nblock: 0, openCount: 0 });

    parent.push({ fileName: name, descriptorIndex: fdIndex });
    this.logger.info(`File ${name} created`);
    // this.rootDirectory.push({ fileName, descriptorIndex: fdIndex });
  }

  open(fileName: string): number {
    const resolvedPath = this.resolveSymlink(fileName, true);
    const { parent, name } = this.resolvePath(resolvedPath);
    const entry = parent.find(e => e.fileName === name);

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
    this.fileDescriptors[fdIndex].openCount++;

    this.logger.info(`fd = ${fdIndex}`);
    return openFd;
  }

  close(fd: number): void {
    const file = this.openFiles[fd];
    if (!file) {
      throw new FileSystemException('invalid descriptor');
    }

    const descriptor = this.fileDescriptors[file.descriptorIndex];
    if (!descriptor) {
      throw new FileSystemException(`Descriptor not found`);
    }

    descriptor.openCount--;
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
        descriptor.blockMap[blockIndex] = this.allocateBlock();
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
    this.logger.info(`Wrote data to file descriptor: ${data.toString()}`);
  }

  link(oldName: string, newName: string): void {
    const { parent, name } = this.resolvePath(oldName);
    const entry = parent.find(e => e.fileName === name);
    // const entry = this.rootDirectory.find((e) => e.fileName === oldName);
    if (!entry) {
      throw new FileSystemException(`${oldName} not found`);
    }

    this.rootDirectory.push({
      fileName: newName, descriptorIndex: entry.descriptorIndex,
    });
    parent.push({
      fileName: newName, descriptorIndex: entry.descriptorIndex,
    });
    this.fileDescriptors[entry.descriptorIndex].hardLinks++;
    this.logger.info(`File ${oldName} linked to ${newName}`);
  }

  unlink(fileName: string): void {
    const { parent, name } = this.resolvePath(this.resolveSymlink(fileName));
    const entryIndex = parent.findIndex(e => e.fileName === name);

    if (entryIndex === -1) {
      throw new FileSystemException(`File not found`);
    }

    const descriptorIndex = parent[entryIndex].descriptorIndex;
    const descriptor = this.fileDescriptors[descriptorIndex];
    if (descriptor.fileType === 'dir') {
      throw new FileSystemException(`Cannot unlink directory`);
    }
    descriptor.hardLinks--;

    if (descriptor.hardLinks === 0) {
      if (descriptor.openCount > 0) {
        this.logger.warn(`File ${fileName} is unlinked but still open`);
      } else {
        for (const blockIndex of descriptor.blockMap) {
          this.freeBlock(blockIndex);
        }
        // @ts-ignore
        this.fileDescriptors[descriptorIndex] = null;
      }
    }

    parent.splice(entryIndex, 1);
    this.logger.info(`File ${name} unlinked`);
  }

  truncate(fileName: string, size: number): void {
    const { parent, name } = this.resolvePath(fileName);
    const entry = parent.find((e) => e.fileName === name);
    if (!entry) {
      throw new FileSystemException(`${fileName} not found`);
    }

    const descriptor = this.fileDescriptors[entry.descriptorIndex];
    if (!descriptor) {
      throw new FileSystemException(`File descriptor not found`);
    }

    if (descriptor.fileType !== 'reg') {
      throw new FileSystemException(`Cannot truncate non-regular file`);
    }

    if (size < 0) {
      throw new FileSystemException(`Size must be non-negative`);
    }

    if (size < descriptor.size) {
      const blockEndIndex = Math.ceil(size / this.BLOCK_SIZE);

      for (let i = blockEndIndex; i < descriptor.blockMap.length; i++) {
        const blockIndex = descriptor.blockMap[i];
        if (blockIndex !== undefined) {
          this.bitmap[blockIndex] = false;
        }
        // @ts-ignore
        descriptor.blockMap[i] = undefined;
      }
      descriptor.blockMap = descriptor.blockMap.slice(0, blockEndIndex);
    }
    descriptor.size = size;
    descriptor.nblock = descriptor.blockMap.filter(block => block !== undefined).length;

    this.logger.info(`File ${fileName} truncated to ${size} bytes`);
  }
}
