import { FileType, IFileDescriptor } from "./interfaces";

export class FileDescriptor implements IFileDescriptor {
  id: number;
  fileType: FileType;
  hardLinks: number;
  size: number;
  blockMap: number[];

  constructor(
    data: IFileDescriptor
  ) {
    const { id, fileType, hardLinks, size, blockMap } = data;
    this.id = id;
    this.fileType = fileType;
    this.hardLinks = hardLinks;
    this.size = size;
    this.blockMap = blockMap;
  }
}
