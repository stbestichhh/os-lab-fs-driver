import { FileSystem } from './fileSystem';
import logger from 'pino';

const log = logger({
  transport: {
    target: 'pino-pretty',
  },
});

const fs = new FileSystem(log);

try {
  fs.mkfs(10);
  fs.create('file.txt');
  fs.stat('file.txt');
  fs.ls();
  fs.link('file.txt', 'document.txt');
  fs.ls();
  fs.stat('document.txt');
  fs.create('some.dat');
  fs.ls();
  fs.truncate('some.dat', 1024);
  fs.stat('some.dat');
  const fd = fs.open('some.dat');
  fs.write(fd, Buffer.from('0123456789'));
  fs.stat('some.dat');
  fs.seek(fd, 7);
  fs.read(fd, 2);
  fs.seek(fd, 256);
  fs.write(fd, Buffer.from('abcdefg'));
  fs.seek(fd, 0);
  fs.read(fd, 384);
  fs.stat('some.dat');
  fs.unlink('some.dat');
  fs.ls();
  fs.seek(fd, 0);
  fs.read(fd, 10);
  fs.close(fd);
} catch (e) {
  const error = e as Error;
  log.error(e, error.message);
}
