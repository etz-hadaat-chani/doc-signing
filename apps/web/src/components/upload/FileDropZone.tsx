import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { type DragEvent, useId, useRef, useState } from 'react';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { type AcceptedFiles, checkFiles, formatFileSize } from './file-checks';

interface FileDropZoneProps {
  accept: AcceptedFiles;
  maxBytes: number;
  /** The chosen file (kept by the parent, which also sends it). */
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

/**
 * Pick one file by button or drag and drop. Shows its name and size; never uploads it and never
 * shows its contents.
 */
export function FileDropZone({
  accept,
  maxBytes,
  file,
  onFileChange,
  disabled = false,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = (files: readonly File[]) => {
    const result = checkFiles(files, accept, maxBytes);
    if (!result) return;
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    onFileChange(result.file);
  };

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };

  const { color } = tokens;

  return (
    <Box>
      <Box
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) take([...event.dataTransfer.files]);
        }}
        data-dragging={dragging || undefined}
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
          p: 3,
          textAlign: 'center',
          border: `1px dashed ${dragging ? color.brand : color.borderStrong}`,
          borderRadius: `${tokens.radius.control}px`,
          backgroundColor: dragging ? color.brandTint : color.surface,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <UploadFileOutlined aria-hidden sx={{ color: 'text.secondary' }} />
        <Typography>{he.upload.dropHere}</Typography>
        <Button
          variant="outlined"
          disabled={disabled}
          aria-describedby={hintId}
          onClick={() => inputRef.current?.click()}
        >
          {he.upload.choose}
        </Button>
        <Typography id={hintId} variant="body2" color="text.secondary">
          {he.upload.allowed(accept.label, formatFileSize(maxBytes))}
        </Typography>
        <input
          ref={inputRef}
          type="file"
          accept={accept.extensions.join(',')}
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onChange={(event) => {
            take([...(event.target.files ?? [])]);
            // The same file can be picked again after a removal.
            event.target.value = '';
          }}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        />
      </Box>

      {error && (
        <Typography role="alert" color="error" variant="body2" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}

      {file && (
        <Box
          aria-label={he.upload.chosen}
          role="group"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}
        >
          <InsertDriveFileOutlined aria-hidden sx={{ color: 'text.secondary' }} />
          <Typography component="bdi" sx={{ fontWeight: tokens.font.weight.medium }}>
            {file.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatFileSize(file.size)}
          </Typography>
          <Button
            variant="outlined"
            disabled={disabled}
            onClick={() => onFileChange(null)}
            sx={{ marginInlineStart: 'auto' }}
          >
            {he.upload.remove}
          </Button>
        </Box>
      )}
    </Box>
  );
}
