import { IDirectoryEntry } from './IDirectoryEntry';

export type FileType = 'reg' | 'dir' | 'sym';

export interface IFileDescriptor {
  id: number;
  fileType: FileType;
  hardLinks: number;
  size: number;
  blockMap: number[];
  nblock: number;
  openCount: number;
  contents?: IDirectoryEntry[] | string;
}
