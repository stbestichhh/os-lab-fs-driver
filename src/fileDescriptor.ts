import { FileType, IDirectoryEntry, IFileDescriptor } from './interfaces';

export class FileDescriptor implements IFileDescriptor {
  id: number;
  fileType: FileType;
  hardLinks: number;
  size: number;
  blockMap: number[];
  nblock: number;
  openCount: number = 0;
  contents?: IDirectoryEntry[] | string;

  constructor(
    data: IFileDescriptor
  ) {
    const { id, fileType, hardLinks, size, blockMap, nblock, contents } = data;
    this.id = id;
    this.fileType = fileType;
    this.hardLinks = hardLinks;
    this.size = size;
    this.blockMap = blockMap;
    this.nblock = nblock;
    this.contents = contents;
  }
}
