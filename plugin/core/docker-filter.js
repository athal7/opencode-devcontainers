/**
 * Shared validation for values embedded in Docker `--filter` arguments
 *
 * Docker's `--filter label=key=value` syntax has no escaping mechanism for
 * the value portion. Control characters (NUL, carriage return, line feed,
 * ...) in the value could corrupt the filter or be misinterpreted by the
 * Docker CLI, so any user-controlled value (e.g. a workspace path) must be
 * validated before it is embedded in a `--filter` argument.
 */

/**
 * Validate a value used in a Docker label filter expression.
 *
 * Rejects values containing control characters that could alter CLI
 * parsing semantics (NUL, CR, LF, and other C0/DEL control characters).
 * Valid workspace paths, including those containing spaces, are unaffected.
 *
 * @param {string} value - Value to validate (e.g. a workspace path)
 * @returns {string} The validated value, unchanged
 * @throws {Error} If value is not a string or contains control characters
 */
export function sanitizeDockerFilterValue(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid value for docker filter: contains disallowed control characters')
  }
  return value
}
