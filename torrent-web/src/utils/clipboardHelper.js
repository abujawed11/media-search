/**
 * Copies text to clipboard with fallback for older browsers
 * @param {string} text - The text to copy
 * @returns {Promise<void>} - Resolves when text is copied
 * @throws {Error} - If copy operation fails
 */
export async function copyText(text) {
  if (!text) {
    throw new Error('Text is required');
  }

  // Try modern Clipboard API first (requires HTTPS or localhost)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn('Clipboard API failed, falling back to execCommand:', error.message);
    }
  }

  // Fallback to legacy document.execCommand approach
  try {
    // Create a temporary textarea element
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');

    // Add to DOM, select, copy, and remove
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!successful) {
      throw new Error('execCommand copy failed');
    }
  } catch (error) {
    throw new Error(`Failed to copy text to clipboard: ${error.message}`);
  }
}