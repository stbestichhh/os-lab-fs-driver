export type FileType = 'reg' | 'dir';

export interface IFileDescriptor {
  id: number;
  fileType: FileType;
  hardLinks: number;
  size: number;
  blockMap: number[];
}
