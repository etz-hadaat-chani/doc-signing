import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { renderComponent } from '../../test/render';
import { checkFiles, formatFileSize } from './file-checks';
import { FileDropZone } from './FileDropZone';

const accept = { extensions: ['.xlsx'], label: 'Excel (.xlsx)' };
const MAX = 5 * 1024 * 1024;

function fileOf(name: string, bytes: number) {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

/** Keeps the chosen file, as a screen does. */
function Harness({ onFileChange }: { onFileChange: (file: File | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <FileDropZone
      accept={accept}
      maxBytes={MAX}
      file={file}
      onFileChange={(next) => {
        setFile(next);
        onFileChange(next);
      }}
    />
  );
}

function renderZone() {
  const onFileChange = vi.fn();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const rendered = renderComponent(<Harness onFileChange={onFileChange} />);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const zone = screen.getByText(he.upload.dropHere).parentElement!;
  return { ...rendered, onFileChange, fetchMock, input, zone };
}

const drop = (zone: HTMLElement, files: File[]) =>
  fireEvent.drop(zone, { dataTransfer: { files, types: ['Files'] } });

describe('formatFileSize', () => {
  it.each([
    [200, he.upload.kilobytes('1')],
    [340 * 1024, he.upload.kilobytes('340')],
    [1.25 * 1024 * 1024, he.upload.megabytes('1.3')],
    [5 * 1024 * 1024, he.upload.megabytes('5')],
  ])('%d bytes → %s', (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });
});

describe('checkFiles', () => {
  it('matches the extension ignoring case', () => {
    expect(checkFiles([fileOf('עובדים.XLSX', 10)], accept, MAX)).toHaveProperty('file');
  });

  it('ignores an empty drop', () => {
    expect(checkFiles([], accept, MAX)).toBeNull();
  });
});

describe('FileDropZone', () => {
  it('shows the allowed types and the maximum size, tied to the button', () => {
    renderZone();
    const hint = he.upload.allowed(accept.label, formatFileSize(MAX));
    expect(screen.getByRole('button', { name: he.upload.choose })).toHaveAccessibleDescription(
      hint,
    );
    expect(document.querySelector('input[type="file"]')).toHaveAttribute('accept', '.xlsx');
  });

  it('a chosen file: name and size shown, given to the parent, nothing uploaded', async () => {
    const { user, input, onFileChange, fetchMock } = renderZone();
    const file = fileOf('עובדים 2026.xlsx', 340 * 1024);
    await user.upload(input, file);

    expect(onFileChange).toHaveBeenCalledWith(file);
    const chosen = screen.getByRole('group', { name: he.upload.chosen });
    expect(chosen).toHaveTextContent('עובדים 2026.xlsx');
    expect(chosen).toHaveTextContent(he.upload.kilobytes('340'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a dropped file is taken too, and Remove clears it', async () => {
    const { user, zone, onFileChange } = renderZone();
    drop(zone, [fileOf('a.xlsx', 2048)]);
    expect(onFileChange).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: he.upload.remove }));
    expect(onFileChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('group', { name: he.upload.chosen })).not.toBeInTheDocument();
  });

  it.each([
    ['a wrong type', [fileOf('a.pdf', 10)], he.upload.wrongType(accept.label)],
    ['two files', [fileOf('a.xlsx', 10), fileOf('b.xlsx', 10)], he.upload.tooMany],
    ['an empty file', [fileOf('a.xlsx', 0)], he.upload.empty],
    ['a file too large', [fileOf('a.xlsx', MAX + 1)], he.upload.tooLarge(formatFileSize(MAX))],
  ])('refuses %s with a Hebrew message', (_name, files, message) => {
    const { zone, onFileChange } = renderZone();
    drop(zone, files);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('clears the message once a good file is chosen', async () => {
    const { user, zone, input } = renderZone();
    drop(zone, [fileOf('a.pdf', 10)]);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.upload(input, fileOf('a.xlsx', 10));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
