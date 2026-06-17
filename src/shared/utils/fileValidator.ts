/**
 * File Upload Validator
 *
 * Validates file uploads by checking MIME type, extension (allowlist),
 * and maximum size (10MB). Rejects executable files.
 *
 * Requirement 12.10: IF uma requisição de upload de arquivo é recebida,
 * THEN THE Platform SHALL validar tipo MIME, extensão e tamanho máximo de
 * 10MB antes de processar, rejeitando arquivos executáveis ou com extensões perigosas.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Maximum allowed file size: 10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB in bytes

/** Allowed MIME types (allowlist) */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Allowed file extensions (allowlist) — must include the leading dot */
export const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
]);

/**
 * Dangerous/executable extensions that are explicitly blocked.
 * Used to provide a more specific error message when the
 * extension is in this list.
 */
export const BLOCKED_EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".sh",
  ".cmd",
  ".ps1",
  ".vbs",
  ".js",
  ".msi",
  ".com",
  ".scr",
  ".jar",
  ".py",
  ".rb",
  ".php",
]);

/**
 * Extracts the lowercase file extension (including the leading dot) from a
 * filename.  Returns an empty string when the filename has no extension.
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return "";
  }
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Validates a browser `File` object for safe upload.
 *
 * Both the MIME type AND the extension must be in their respective
 * allowlists for the file to be considered valid.
 *
 * @param file - The `File` object obtained from an `<input type="file">` or
 *   a drag-and-drop event.
 * @returns `{ valid: true }` when the file passes all checks, or
 *   `{ valid: false, error: string }` with a descriptive Portuguese message.
 */
export function validateUpload(file: File): ValidationResult {
  // ── 1. Size check ──────────────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `O arquivo "${file.name}" excede o tamanho máximo permitido de 10MB. Tamanho atual: ${(file.size / (1024 * 1024)).toFixed(2)}MB.`,
    };
  }

  // ── 2. Extension check ─────────────────────────────────────────────────────
  const extension = getExtension(file.name);

  if (extension === "") {
    return {
      valid: false,
      error: `O arquivo "${file.name}" não possui extensão. Apenas arquivos com extensões permitidas podem ser enviados.`,
    };
  }

  if (BLOCKED_EXECUTABLE_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      error: `O arquivo "${file.name}" possui uma extensão executável ou perigosa (${extension}), que não é permitida por razões de segurança.`,
    };
  }

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    const allowed = [...ALLOWED_EXTENSIONS].join(", ");
    return {
      valid: false,
      error: `A extensão "${extension}" do arquivo "${file.name}" não é permitida. Extensões aceitas: ${allowed}.`,
    };
  }

  // ── 3. MIME type check ─────────────────────────────────────────────────────
  const mimeType = file.type.toLowerCase();

  if (!mimeType) {
    return {
      valid: false,
      error: `Não foi possível determinar o tipo do arquivo "${file.name}". Apenas arquivos com tipos MIME reconhecidos são aceitos.`,
    };
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `O tipo de arquivo "${mimeType}" (arquivo "${file.name}") não é permitido. Apenas imagens (JPEG, PNG, GIF, WebP), PDF, documentos Word (.doc, .docx) e texto simples são aceitos.`,
    };
  }

  return { valid: true };
}

/**
 * Validates a file coming from a `FormData` object (API route context).
 *
 * This async variant is designed for use in Next.js API routes and Server
 * Actions, where files arrive as `Blob`/`File` entries inside a `FormData`.
 *
 * @param formData - The `FormData` instance from the request.
 * @param fieldName - The name of the field that contains the file.
 * @returns A `Promise<ValidationResult>`.
 */
export async function validateUploadAsync(
  formData: FormData,
  fieldName: string,
): Promise<ValidationResult> {
  const entry = formData.get(fieldName);

  if (entry === null) {
    return {
      valid: false,
      error: `Nenhum arquivo encontrado no campo "${fieldName}". Certifique-se de que o arquivo foi incluído na requisição.`,
    };
  }

  if (typeof entry === "string") {
    return {
      valid: false,
      error: `O campo "${fieldName}" contém texto, mas era esperado um arquivo.`,
    };
  }

  // `entry` is a Blob; if it comes from a browser FormData it is a File and
  // already has a `name` property. In Node.js (test / server environments) the
  // Web API `File` class is available from Node 20+.
  const file =
    entry instanceof File
      ? entry
      : new File([entry as Blob], fieldName, { type: (entry as Blob).type });

  return validateUpload(file);
}
