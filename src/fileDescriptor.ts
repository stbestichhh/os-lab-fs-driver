import { FileType, IFileDescriptor } from "./interfaces";

export class FileDescriptor implements IFileDescriptor {
  id: number;
  fileType: FileType;
  hardLinks: number;
  size: number;
  blockMap: number[];
  nblock: number;
  isOpen?: boolean;

  constructor(
    data: IFileDescriptor
  ) {
    const { id, fileType, hardLinks, size, blockMap, nblock } = data;
    this.id = id;
    this.fileType = fileType;
    this.hardLinks = hardLinks;
    this.size = size;
    this.blockMap = blockMap;
    this.nblock = nblock;
  }
}
