/**
 * Tests for fileValidator.ts
 *
 * Requirement 12.10: validates MIME type, extension (allowlist) and
 * max file size of 10MB, rejecting executables.
 */
import { describe, it, expect } from 'vitest';
import {
  validateUpload,
  validateUploadAsync,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  BLOCKED_EXECUTABLE_EXTENSIONS,
} from './fileValidator';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal File object with the given name, type and size.
 * The content is just zero-filled bytes of the requested length.
 */
function makeFile(name: string, type: string, sizeBytes: number = 1024): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('MAX_FILE_SIZE is 10 MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  it('ALLOWED_MIME_TYPES contains expected types', () => {
    const expected = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    for (const mime of expected) {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(true);
    }
  });

  it('ALLOWED_EXTENSIONS contains expected extensions', () => {
    const expected = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.txt', '.doc', '.docx'];
    for (const ext of expected) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('BLOCKED_EXECUTABLE_EXTENSIONS contains dangerous extensions', () => {
    const dangerous = ['.exe', '.bat', '.sh', '.cmd', '.ps1', '.vbs', '.js', '.msi', '.com', '.scr', '.jar', '.py', '.rb', '.php'];
    for (const ext of dangerous) {
      expect(BLOCKED_EXECUTABLE_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});

// ── validateUpload: valid files ───────────────────────────────────────────────

describe('validateUpload — valid files', () => {
  it('accepts a JPEG image', () => {
    const file = makeFile('photo.jpg', 'image/jpeg');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a PNG image', () => {
    const file = makeFile('screenshot.png', 'image/png');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a GIF image', () => {
    const file = makeFile('anim.gif', 'image/gif');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a WebP image', () => {
    const file = makeFile('image.webp', 'image/webp');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a PDF document', () => {
    const file = makeFile('contract.pdf', 'application/pdf');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a plain text file', () => {
    const file = makeFile('notes.txt', 'text/plain');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a .doc Word document', () => {
    const file = makeFile('petição.doc', 'application/msword');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a .docx Word document', () => {
    const file = makeFile('contrato.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a file with uppercase extension (.PDF)', () => {
    // Extension comparison must be case-insensitive
    const file = makeFile('LAUDO.PDF', 'application/pdf');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a JPEG file with .jpeg extension', () => {
    const file = makeFile('foto.jpeg', 'image/jpeg');
    expect(validateUpload(file)).toEqual({ valid: true });
  });

  it('accepts a file exactly at the 10 MB limit', () => {
    const file = makeFile('big.pdf', 'application/pdf', MAX_FILE_SIZE);
    expect(validateUpload(file)).toEqual({ valid: true });
  });
});

// ── validateUpload: size violations ──────────────────────────────────────────

describe('validateUpload — size violations', () => {
  it('rejects a file that is 1 byte over 10 MB', () => {
    const file = makeFile('huge.pdf', 'application/pdf', MAX_FILE_SIZE + 1);
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10MB');
  });

  it('rejects a 50 MB file', () => {
    const file = makeFile('toobig.pdf', 'application/pdf', 50 * 1024 * 1024);
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10MB');
  });

  it('error message includes actual file size in MB', () => {
    const sizeBytes = 15 * 1024 * 1024;
    const file = makeFile('large.pdf', 'application/pdf', sizeBytes);
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    // 15MB should appear in the error
    expect(result.error).toMatch(/15(\.\d+)?MB/);
  });
});

// ── validateUpload: extension violations ─────────────────────────────────────

describe('validateUpload — extension violations', () => {
  it('rejects a file with no extension', () => {
    const file = makeFile('Makefile', 'text/plain');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects an .exe executable', () => {
    const file = makeFile('malware.exe', 'application/octet-stream');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.exe');
  });

  it('rejects a .bat script', () => {
    const file = makeFile('script.bat', 'application/bat');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.bat');
  });

  it('rejects a .sh shell script', () => {
    const file = makeFile('deploy.sh', 'application/x-sh');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.sh');
  });

  it('rejects a .js JavaScript file', () => {
    const file = makeFile('payload.js', 'application/javascript');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.js');
  });

  it('rejects a .php file', () => {
    const file = makeFile('shell.php', 'application/x-php');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.php');
  });

  it('rejects a .py Python script', () => {
    const file = makeFile('exploit.py', 'text/x-python');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.py');
  });

  it('rejects a .zip archive (not in allowlist)', () => {
    const file = makeFile('archive.zip', 'application/zip');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.zip');
  });

  it('rejects a .csv file (not in allowlist)', () => {
    const file = makeFile('data.csv', 'text/csv');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.csv');
  });
});

// ── validateUpload: MIME type violations ──────────────────────────────────────

describe('validateUpload — MIME type violations', () => {
  it('rejects a file with an empty MIME type', () => {
    const file = makeFile('file.pdf', '');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a PDF extension with wrong MIME type (application/zip)', () => {
    // Extension is fine but MIME is wrong — both must pass
    const file = makeFile('tricky.pdf', 'application/zip');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('application/zip');
  });

  it('rejects application/x-msdownload MIME type', () => {
    // Someone tries to upload an .exe disguised with a .jpg extension
    const file = makeFile('photo.jpg', 'application/x-msdownload');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
  });

  it('rejects application/octet-stream even with valid extension', () => {
    const file = makeFile('document.pdf', 'application/octet-stream');
    const result = validateUpload(file);
    expect(result.valid).toBe(false);
  });
});

// ── validateUpload: error messages in Portuguese ──────────────────────────────

describe('validateUpload — Portuguese error messages', () => {
  it('size error is written in Portuguese', () => {
    const file = makeFile('big.pdf', 'application/pdf', MAX_FILE_SIZE + 1);
    const result = validateUpload(file);
    // Should contain Portuguese keywords
    expect(result.error).toMatch(/tamanho|máximo|excede/i);
  });

  it('executable extension error is written in Portuguese', () => {
    const file = makeFile('run.exe', 'application/octet-stream');
    const result = validateUpload(file);
    expect(result.error).toMatch(/executável|perigosa|segurança/i);
  });

  it('unknown extension error is written in Portuguese', () => {
    const file = makeFile('data.xyz', 'text/plain');
    const result = validateUpload(file);
    expect(result.error).toMatch(/extensão|permitid/i);
  });

  it('MIME type error is written in Portuguese', () => {
    const file = makeFile('doc.pdf', 'application/zip');
    const result = validateUpload(file);
    expect(result.error).toMatch(/tipo|permitido|aceito/i);
  });
});

// ── validateUpload: both checks must pass ────────────────────────────────────

describe('validateUpload — both MIME and extension must be valid', () => {
  it('fails when extension is valid but MIME is not', () => {
    const file = makeFile('file.png', 'application/octet-stream');
    expect(validateUpload(file).valid).toBe(false);
  });

  it('fails when MIME is valid but extension is not', () => {
    const file = makeFile('file.xyz', 'image/png');
    expect(validateUpload(file).valid).toBe(false);
  });

  it('passes only when both extension and MIME are in allowlists', () => {
    const file = makeFile('image.png', 'image/png');
    expect(validateUpload(file)).toEqual({ valid: true });
  });
});

// ── validateUploadAsync ───────────────────────────────────────────────────────

describe('validateUploadAsync', () => {
  it('returns valid for a correct file in FormData', async () => {
    const formData = new FormData();
    const file = makeFile('report.pdf', 'application/pdf');
    formData.append('attachment', file);

    const result = await validateUploadAsync(formData, 'attachment');
    expect(result).toEqual({ valid: true });
  });

  it('returns error when field is missing', async () => {
    const formData = new FormData();

    const result = await validateUploadAsync(formData, 'attachment');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('attachment');
  });

  it('returns error when field contains a string instead of a file', async () => {
    const formData = new FormData();
    formData.append('attachment', 'just a string value');

    const result = await validateUploadAsync(formData, 'attachment');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('texto');
  });

  it('rejects an oversized file in FormData', async () => {
    const formData = new FormData();
    const file = makeFile('huge.pdf', 'application/pdf', MAX_FILE_SIZE + 1);
    formData.append('file', file);

    const result = await validateUploadAsync(formData, 'file');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10MB');
  });

  it('rejects an executable file in FormData', async () => {
    const formData = new FormData();
    const file = makeFile('virus.exe', 'application/octet-stream');
    formData.append('upload', file);

    const result = await validateUploadAsync(formData, 'upload');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.exe');
  });
});
