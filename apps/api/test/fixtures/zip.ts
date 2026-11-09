import yauzl from 'yauzl';

export interface ZipEntry {
  name: string;
  /** The raw name bytes as stored in the central directory. */
  rawName: Buffer;
  /** General purpose bit 11: the name is UTF-8. */
  utf8Flag: boolean;
  content: Buffer;
}

/** Every entry of a ZIP, read the way an unzip tool reads it (yauzl). */
export function readZip(zip: Buffer): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true, decodeStrings: false }, (error, file) => {
      if (error) return reject(error);
      const entries: ZipEntry[] = [];
      file.on('error', reject);
      file.on('end', () => resolve(entries));
      file.on('entry', (entry: yauzl.Entry) => {
        file.openReadStream(entry, (openError, stream) => {
          if (openError) return reject(openError);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            const rawName = entry.fileName as unknown as Buffer;
            entries.push({
              name: rawName.toString('utf8'),
              rawName,
              utf8Flag: (entry.generalPurposeBitFlag & 0x800) !== 0,
              content: Buffer.concat(chunks),
            });
            file.readEntry();
          });
        });
      });
      file.readEntry();
    });
  });
}
